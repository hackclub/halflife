import { getTier } from "../src/lib/config/tiers"
import { lockUserCredit, reconcileGrant } from "../src/lib/currency"
import { CoinBucket, LedgerKind, Phase, PhaseStatus, ReviewResult } from "../src/lib/enums"
import { designCoinsFor } from "../src/lib/hours"
import db from "../src/lib/prisma8"

/**
 * Pay the coins that approved designs with declined parts funding never earned.
 *
 * A declined grant bought no hours, but `designCoinsFor` still subtracted the tier's funded block, so the hours that money would have bought paid nothing – up to 100 coins a project on Tier 3. Paying those hours like any other is fixed for future approvals only: a resolved submission cannot be re-decided, and un-approving it would reverse the grant and put the maker back to re-submitting. So the shortfall is paid the way every other coin is, as an append-only ledger row reconciled to the amount the corrected maths would have minted.
 *
 * Dry run by default – it prints one line per design and writes nothing. Pass `--apply` to write.
 *
 * Safe to run again: each project's `DESIGN_EXCESS_HOURS` rows are reconciled to a target rather than appended blindly, so a second run finds nothing left to pay. It only ever pays up; a design that was already paid at or above the corrected figure (a reviewer's explicit grant, or a manual adjustment) is reported and left alone.
 */
async function main() {
	const apply = process.argv.includes("--apply")

	const submissions = await db.orm.public.PhaseSubmission.where({ fundingDeclined: true, phase: Phase.DESIGN })
		.include("themeProject", project =>
			project
				.select("designStatus", "grantUsd", "id", "tier", "title", "userId")
				.include("user", user => user.select("email", "name")),
		)
		.include("reviews", review =>
			review.select(
				"createdAt",
				"id",
				"frozenApprovedHours",
				"frozenGrantUsd",
				"frozenSpendableCoins",
				"frozenTier",
				"invalidated",
				"result",
			),
		)
		.all()

	interface Payout {
		banked: number
		delta: number
		email: string
		excess: number
		fundedHoursPaid: number
		hours: number
		paid: number
		projectId: string
		target: number
		tier: number
		title: string
		userId: string
	}

	// A project can have more than one design submission on record (a return, then another hand-in). Only the one whose decision still stands pays, and that is the newest live review.
	const seen = new Set<string>()
	const payouts: Payout[] = []
	for (const submission of submissions) {
		const project = submission.themeProject
		if (!project || submission.resolvedResult !== ReviewResult.APPROVED) continue
		if (project.designStatus !== PhaseStatus.approved || seen.has(project.id)) continue

		const live = submission.reviews
			.filter(review => !review.invalidated && review.result === ReviewResult.APPROVED)
			.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
			.at(-1)
		if (!live || live.frozenApprovedHours === null) continue

		const tier = getTier(live.frozenTier ?? project.tier ?? 0)
		if (!tier) continue
		seen.add(project.id)

		// The funded block is whatever the grant bought at the time. Declining normally bought nothing, so every approved hour should have paid; an explicit reviewer override bought the tier's block, and that payout was already correct.
		const grantUsd = live.frozenGrantUsd ?? project.grantUsd ?? 0
		const fundedHours = grantUsd > 0 ? tier.fundingHours : 0
		const target = designCoinsFor(tier.id, live.frozenApprovedHours, { fundedHours }).spendable

		const banked =
			(
				await db.orm.public.LedgerEntry.where({ themeProjectId: project.id, userId: project.userId })
					.where(entry => entry.kind.in([LedgerKind.DESIGN_BANKED_HOURS]))
					.aggregate(sum => ({ total: sum.sum("amount") }))
			).total ?? 0
		const excess =
			(
				await db.orm.public.LedgerEntry.where({ themeProjectId: project.id, userId: project.userId })
					.where(entry => entry.kind.in([LedgerKind.DESIGN_EXCESS_HOURS]))
					.aggregate(sum => ({ total: sum.sum("amount") }))
			).total ?? 0

		payouts.push({
			banked,
			delta: target - (banked + excess),
			email: project.user?.email ?? project.userId,
			excess,
			fundedHoursPaid: fundedHours,
			hours: live.frozenApprovedHours,
			paid: banked + excess,
			projectId: project.id,
			target,
			tier: tier.id,
			title: project.title,
			userId: project.userId,
		})
	}

	const due = payouts.filter(payout => payout.delta > 0)
	for (const payout of payouts) {
		const state = payout.delta > 0 ? `short ${payout.delta}` : payout.delta === 0 ? "already correct" : "already above"
		console.log(
			`${payout.email} · ${payout.title}: ${payout.hours}h at tier ${payout.tier}, ${payout.fundedHoursPaid}h funded, paid ${payout.paid}, owed ${payout.target} – ${state}`,
		)
	}

	// The ledger is what a balance is, so the correction is a ledger row like any other mint. `designSpendableCoins` is a display field the admin user page reads, so it is moved with it.
	let total = 0
	for (const payout of due) {
		total += payout.delta
		if (!apply) continue
		await db.transaction(async tx => {
			await lockUserCredit(tx, payout.userId)
			await reconcileGrant(tx, {
				bucket: CoinBucket.SPENDABLE,
				createdById: null,
				kind: LedgerKind.DESIGN_EXCESS_HOURS,
				// The maker reads this in their coin history, so it names the cause rather than the bug.
				note: `Declined parts funding on ${payout.title}: every approved hour of a design without a grant earns coins`,
				// Reconciled against the total plainly, so any legacy banked rows on the project are left where they are and the excess carries the rest.
				target: payout.target - payout.banked,
				themeProjectId: payout.projectId,
				userId: payout.userId,
			})
			await tx.orm.public.ThemeProject.where({ id: payout.projectId }).update({
				designSpendableCoins: payout.target,
			})
		})
	}

	console.log(`\n${payouts.length} declined design(s) checked, ${due.length} short by ${total} coins in total.`)
	if (due.length > 0 && !apply) console.log("Dry run: pass --apply to write the ledger rows.")
	if (due.length > 0 && apply) console.log("Applied.")
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
