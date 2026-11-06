import { or } from "@prisma/orm-postgres/orm-client"
import { THEME_COMPLETION_BONUS } from "../src/lib/config/program"
import { getTier } from "../src/lib/config/tiers"
import { LedgerKind, Phase, PhaseStatus, ReviewResult, Theme } from "../src/lib/enums"
import { buildCoinsFor, designCoinsFor } from "../src/lib/hours"
import db from "../src/lib/prisma8"

/**
 * Explain every approved phase that was paid no coins, or fewer than its decision says.
 *
 * Read-only. It walks the approvals that still stand and compares two things that should
 * agree: what the frozen decision says was earned, and what the ledger actually holds.
 * That separates the ordinary zero from a real gap:
 *
 * - `FUNDED_BLOCK` – a design approved at or below its tier's funded hours. Those hours buy
 *   parts and earn no coins by design; coins start above the block.
 * - `ZERO_HOURS` – approved with 0h despite logged work. The live path now fixes this; the
 *   backfill script repairs the ones that already landed.
 * - `SHORT` – the decision says coins were earned but the ledger holds less. This is the
 *   case that means a write went missing.
 * - `NO_APPROVAL_RECORD` – the project says approved but no standing approval row exists
 *   (an import or manual status write, not a decision this app made).
 *
 * Run with `bun --conditions=react-server scripts/audit-approved-coins.ts`.
 */
async function main() {
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => or(project.designStatus.eq(PhaseStatus.approved), project.buildStatus.eq(PhaseStatus.approved)))
		.select(
			"approvedHours",
			"buildStatus",
			"designApprovedHours",
			"designStatus",
			"grantUsd",
			"id",
			"requestedTier",
			"theme",
			"tier",
			"title",
			"userId",
		)
		.include("user", user => user.select("email"))
		.all()

	const submissions = await db.orm.public.PhaseSubmission.where({ resolvedResult: ReviewResult.APPROVED })
		.select("id", "phase", "themeProjectId")
		.include("reviews", review =>
			review.select(
				"createdAt",
				"frozenApprovedHours",
				"frozenFundingHours",
				"frozenGrantUsd",
				"frozenHackatimeHours",
				"frozenJournalHours",
				"frozenSpendableCoins",
				"frozenTier",
				"hoursOverride",
				"invalidated",
				"result",
				"reviewerId",
			),
		)
		.all()

	interface Decision {
		createdAt: string
		hoursOverride: number | null
		review: {
			frozenApprovedHours: number | null
			frozenFundingHours: number | null
			frozenGrantUsd: number | null
			frozenHackatimeHours: number | null
			frozenJournalHours: number | null
			frozenSpendableCoins: number | null
			frozenTier: number | null
		}
		reviewerId: string | null
	}

	const decisions = new Map<string, Decision>()
	for (const submission of submissions) {
		const key = `${submission.themeProjectId}:${submission.phase}`
		for (const review of submission.reviews) {
			if (review.invalidated || review.result !== ReviewResult.APPROVED) continue
			const current = decisions.get(key)
			if (!current || review.createdAt > current.createdAt)
				decisions.set(key, {
					createdAt: review.createdAt,
					hoursOverride: review.hoursOverride,
					review,
					reviewerId: review.reviewerId,
				})
		}
	}

	async function ledgerTotal(themeProjectId: string, userId: string, kinds: LedgerKind[]): Promise<number> {
		const { total } = await db.orm.public.LedgerEntry.where({ themeProjectId, userId })
			.where(entry => entry.kind.in(kinds))
			.aggregate(sum => ({ total: sum.sum("amount") }))
		return total ?? 0
	}

	const counts: { [_: string]: number } = {}
	const rows: string[] = []

	for (const project of projects)
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status !== PhaseStatus.approved) continue

			const key = `${project.id}:${phase}`
			const decision = decisions.get(key)
			const kinds =
				phase === Phase.DESIGN
					? [LedgerKind.DESIGN_BANKED_HOURS, LedgerKind.DESIGN_EXCESS_HOURS]
					: [LedgerKind.BUILD_BANKED_HOURS, LedgerKind.BUILD_HOURS, LedgerKind.THEME_COMPLETION_BONUS]
			const paid = await ledgerTotal(project.id, project.userId, kinds)

			if (!decision) {
				counts.NO_APPROVAL_RECORD = (counts.NO_APPROVAL_RECORD ?? 0) + 1
				rows.push(
					`${project.user?.email ?? project.userId} · ${project.title} (${phase.toLowerCase()}): project approved, no standing approval row; ledger holds ${paid}`,
				)
				continue
			}

			const hours = decision.review.frozenApprovedHours ?? 0
			const frozenWork = (decision.review.frozenJournalHours ?? 0) + (decision.review.frozenHackatimeHours ?? 0)
			let expected = 0
			let fundedHours = 0
			let grantUsd = 0
			let tier = 0

			if (phase === Phase.DESIGN) {
				const tierRow = getTier(decision.review.frozenTier ?? project.tier ?? project.requestedTier ?? 0)
				if (!tierRow) {
					counts.NO_TIER = (counts.NO_TIER ?? 0) + 1
					rows.push(
						`${project.user?.email ?? project.userId} · ${project.title} (design): approved but no valid tier; ledger holds ${paid}`,
					)
					continue
				}
				tier = tierRow.id
				grantUsd = decision.review.frozenGrantUsd ?? project.grantUsd ?? 0
				fundedHours = decision.review.frozenFundingHours ?? (grantUsd > 0 ? tierRow.fundingHours : 0)
				expected = designCoinsFor(tierRow.id, hours, { fundedHours }).spendable
			} else expected = buildCoinsFor(hours).spendable + (project.theme === Theme.WARMUP ? 0 : THEME_COMPLETION_BONUS)

			const reason =
				expected === 0
					? hours === 0 && frozenWork > 0
						? "ZERO_HOURS"
						: phase === Phase.DESIGN && hours <= fundedHours
							? "FUNDED_BLOCK"
							: "EXPECTED_ZERO"
					: paid < expected
						? "SHORT"
						: paid > expected
							? "OVERPAID"
							: "OK"

			counts[reason] = (counts[reason] ?? 0) + 1
			if (reason === "OK") continue

			const detail =
				phase === Phase.DESIGN
					? `design, ${hours}h approved, ${fundedHours}h funded at tier ${tier} ($${grantUsd} grant)`
					: `build, ${hours}h approved`
			rows.push(
				`${project.user?.email ?? project.userId} · ${project.title}: ${detail}; expected ${expected}, ledger ${paid} – ${reason}${decision.hoursOverride === 0 ? ", recorded with a 0h override" : ""}`,
			)
		}

	// Funded-block zeroes are the normal case, so they are counted but the rows are last:
	// what an operator needs first is the approvals whose ledger disagrees with the decision.
	const interesting = rows.filter(row => !row.endsWith("FUNDED_BLOCK"))
	const funded = rows.filter(row => row.endsWith("FUNDED_BLOCK"))
	for (const row of interesting) console.log(row)
	if (funded.length > 0) {
		console.log(
			`\n${funded.length} design approval(s) paid 0 because the approved hours sit inside the tier's funded block:`,
		)
		for (const row of funded) console.log(`  ${row}`)
	}

	console.log("\nSummary:")
	for (const [reason, count] of Object.entries(counts).toSorted(([a], [b]) => a.localeCompare(b)))
		console.log(`  ${reason}: ${count}`)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
