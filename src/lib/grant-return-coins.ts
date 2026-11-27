import "server-only"
import { lockUserCredit, reconcileGrant } from "@/lib/currency"
import { HcbGrantCardStatus, LedgerKind, Phase, PhaseStatus } from "@/lib/enums"
import { grantCardCapUsd } from "@/lib/grant-card-policy"
import { isWeekOneStarter } from "@/lib/grant-cards"
import { readCardGrantSpend } from "@/lib/hcb"
import { MAKER_RETURN_STATUS, PRE_ACTIVATION_STATUS } from "@/lib/hcb-buffer-topups"
import db from "@/lib/prisma8"

/**
 * Coins for a design whose grant card was handed back, or converted to a reimbursement.
 *
 * The maker could have claimed up to the project's cap, so the part of the cap they did not spend is theirs in coins: the cap less what the cards spent. Whatever was never issued counts the same as whatever came back, and top-ups add nothing, since they are not part of the cap.
 *
 * One coin is one dollar, and whole coins only, so a half-dollar left over is not paid.
 */
export function grantReturnCoins(capUsd: number, issuedCents: number, spentCents: number): number {
	const capCents = Math.round(capUsd * 100)
	const spent = Math.min(spentCents, issuedCents)
	return Math.max(0, Math.floor((capCents - spent) / 100))
}

export interface GrantReturnCoinsResult {
	/** Total coins written across those designs in this run. */
	coinsWritten: number
	dryRun: boolean
	/** Designs paid or topped up to a new figure. */
	projectsPaid: number
	/** Designs with a returned card that were not paid, with the reason. */
	skipped: { reason: string; themeProjectId: string }[]
}

/**
 * The HCB grant statuses that mean the maker handed the balance back, and so earn coins. A conversion to a reimbursement is
 * requested by someone other than the maker, so it never gets this status and is left out on purpose.
 */
export const PLAIN_RETURN_STATUSES: readonly string[] = [MAKER_RETURN_STATUS]

/**
 * Whether a returned card earns coins. A grant cancelled before activation always does: the site counted it as issued, and
 * nothing was spent, so its whole cap is unspent. Other returns earn coins only once their status is in the plain list.
 */
const isPayableReturn = (hcbStatus: string | null): boolean =>
	hcbStatus === PRE_ACTIVATION_STATUS || (hcbStatus !== null && PLAIN_RETURN_STATUSES.includes(hcbStatus))

interface ReturnedDesignCard {
	amountCents: number
	hcbCardGrantId: string | null
	hcbStatus: string | null
	id: string
	spentCents: number | null
	themeProjectId: string
	userId: string
}

/**
 * Pay the unspent part of every returned or converted design grant, reconciled to its target so a re-run pays nothing twice.
 *
 * Designs with no tier, no approved grant, or a declined grant are skipped. A declined grant was never taken out of the cap, so there is nothing to pay back. A design whose spend HCB cannot report is also skipped and tried again next run, rather than guessed at.
 */
export async function syncGrantReturnCoins(input: { dryRun: boolean }): Promise<GrantReturnCoinsResult> {
	const cards: ReturnedDesignCard[] = await db.orm.public.HcbGrantCard.where({
		phase: Phase.DESIGN,
		status: HcbGrantCardStatus.RETURNED,
	})
		.select("amountCents", "hcbCardGrantId", "hcbStatus", "id", "spentCents", "themeProjectId", "userId")
		.all()

	const byProject = new Map<string, ReturnedDesignCard[]>()
	for (const card of cards) {
		if (!card.themeProjectId) continue
		const list = byProject.get(card.themeProjectId) ?? []
		list.push(card)
		byProject.set(card.themeProjectId, list)
	}
	const projectIds = [...byProject.keys()]
	const projects =
		projectIds.length === 0
			? []
			: await db.orm.public.ThemeProject.where(project => project.id.in(projectIds))
					.select("designStatus", "grantUsd", "id", "starterProjectId", "tier", "title")
					.all()
	const declinedRows =
		projectIds.length === 0
			? []
			: await db.orm.public.PhaseSubmission.where({ fundingDeclined: true, phase: Phase.DESIGN })
					.where(row => row.themeProjectId.in(projectIds))
					.select("themeProjectId")
					.all()
	const declined = new Set(declinedRows.map(row => row.themeProjectId))

	const result: GrantReturnCoinsResult = { coinsWritten: 0, dryRun: input.dryRun, projectsPaid: 0, skipped: [] }
	for (const project of projects) {
		const group = byProject.get(project.id) ?? []
		const skip = (reason: string): void => {
			result.skipped.push({ reason, themeProjectId: project.id })
		}
		if (project.designStatus !== PhaseStatus.approved) {
			skip("The design is not approved, so nothing is paid")
			continue
		}
		if (declined.has(project.id)) {
			skip("Parts funding was declined, so nothing was taken out of the cap")
			continue
		}
		if (group.some(card => !isPayableReturn(card.hcbStatus))) {
			skip("HCB's status for this grant is not confirmed as a plain return, so it is not paid")
			continue
		}
		const capUsd = grantCardCapUsd(project.grantUsd, project.tier, isWeekOneStarter(project.starterProjectId))
		if (capUsd === null || (project.grantUsd ?? 0) <= 0) {
			skip("No tier or approved grant to cap the coins at")
			continue
		}

		// Read the spend once per card and keep it: after the return HCB no longer shows the balance, so this figure is the only record.
		const spent: number[] = []
		let unknown = false
		for (const card of group) {
			if (card.spentCents !== null) {
				spent.push(card.spentCents)
				continue
			}
			// Cancelled before activation: there was never a card to spend from.
			if (card.hcbStatus === PRE_ACTIVATION_STATUS) {
				spent.push(0)
				continue
			}
			const read = card.hcbCardGrantId ? await readCardGrantSpend(card.hcbCardGrantId) : null
			if (read?.spentCents === null || read?.spentCents === undefined) {
				unknown = true
				break
			}
			spent.push(read.spentCents)
			if (!input.dryRun) await db.orm.public.HcbGrantCard.where({ id: card.id }).update({ spentCents: read.spentCents })
		}
		if (unknown) {
			skip("HCB could not say what the card has spent yet")
			continue
		}

		const issuedCents = group.reduce((sum, card) => sum + card.amountCents, 0)
		const spentCents = spent.reduce((sum, value) => sum + value, 0)
		const target = grantReturnCoins(capUsd, issuedCents, spentCents)
		const userId = group[0]?.userId
		if (userId === undefined) continue
		if (!input.dryRun)
			await db.transaction(async tx => {
				await lockUserCredit(tx, userId)
				await reconcileGrant(tx, {
					kind: LedgerKind.GRANT_RETURN_COINS,
					note: `Unspent grant for ${project.title} paid as coins: $${capUsd} cap less $${(spentCents / 100).toFixed(2)} spent`,
					target,
					themeProjectId: project.id,
					userId,
				})
			})
		result.projectsPaid += 1
		result.coinsWritten += target
	}
	return result
}
