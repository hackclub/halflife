import { THEME_COMPLETION_BONUS } from "../src/lib/config/program"
import { getTier } from "../src/lib/config/tiers"
import { lockUserCredit, reconcileGrant } from "../src/lib/currency"
import { CoinBucket, LedgerKind, Phase, PhaseStatus, ReviewResult, Theme } from "../src/lib/enums"
import { buildCoinsFor, designCoinsFor } from "../src/lib/hours"
import { round2 } from "../src/lib/money"
import db from "../src/lib/prisma8"

/**
 * Pay the coins that approvals recorded with a zero approved-hours override never earned.
 *
 * Ari's review payload carries `approved_hours` / `approved_minutes`, and a machine that left
 * the field at its default sent 0. That zero was accepted as an authoritative figure, so the
 * phase was frozen at 0h and minted 0 coins (a design) or only the flat completion bonus (a
 * build) while still being marked approved. The live path now treats a zero as "no figure"
 * and falls back to the hours Half Life computed; this repairs the approvals that already landed.
 *
 * The frozen review is enough to find them without guessing: an hour override of exactly 0
 * alongside frozen journal/Hackatime hours above 0 is the bug's fingerprint. The corrected
 * figure is those frozen hours, and the correction is paid as an append-only ledger row
 * reconciled to the amount the corrected maths would have minted. Console reviews with an
 * explicit 0h override are reported but never paid automatically – the form omits the field
 * when blank, so a person's zero was a real decision.
 *
 * Dry run by default – it prints one line per affected approval and writes nothing. Pass
 * `--apply` to write. A project is addressed once per phase; re-running is safe because each
 * ledger kind is reconciled to a target rather than appended blindly, and a row already at or
 * above its corrected payout is reported and left alone.
 *
 * Grants are deliberately untouched. These approvals also recorded a $0 grant (the zero hours
 * made the tier step down to no parts money); restoring that is a separate financial decision
 * for staff, not something a coin backfill should do silently.
 */
async function main() {
	const apply = process.argv.includes("--apply")

	const submissions = await db.orm.public.PhaseSubmission.where({ resolvedResult: ReviewResult.APPROVED })
		.include("themeProject", project =>
			project
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
				.include("user", user => user.select("email", "name")),
		)
		.include("reviews", review =>
			review.select(
				"createdAt",
				"frozenApprovedHours",
				"frozenBankedCoins",
				"frozenFundingHours",
				"frozenGrantUsd",
				"frozenHackatimeHours",
				"frozenJournalHours",
				"frozenSpendableCoins",
				"frozenTier",
				"grantUsdOverride",
				"hoursOverride",
				"id",
				"invalidated",
				"reviewerId",
				"result",
			),
		)
		.all()

	interface Target {
		bucket: CoinBucket
		kind: LedgerKind
		target: number
	}

	interface Repair {
		correctedHours: number
		current: number
		delta: number
		email: string
		hours: number
		phase: Phase
		projectId: string
		reviewId: string
		spendable: number
		targets: Target[]
		title: string
		userId: string
	}

	async function ledgerTotal(themeProjectId: string, userId: string, kinds: LedgerKind[]): Promise<number> {
		const { total } = await db.orm.public.LedgerEntry.where({ themeProjectId, userId })
			.where(entry => entry.kind.in(kinds))
			.aggregate(sum => ({ total: sum.sum("amount") }))
		return total ?? 0
	}

	// A project can have more than one hand-in per phase (a return, then another). Only the
	// decision still standing pays, and the newest live approval is that decision.
	const seen = new Set<string>()
	const repairs: Repair[] = []

	for (const submission of submissions) {
		const project = submission.themeProject
		if (!project) continue

		const { phase } = submission
		const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
		if (status !== PhaseStatus.approved) continue

		const live = submission.reviews
			.filter(review => !review.invalidated && review.result === ReviewResult.APPROVED)
			.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
			.at(-1)
		if (!live) continue

		// The fingerprint. A non-zero override, or no override at all, is not this bug.
		if (live.hoursOverride !== 0) continue
		// A console reviewer's zero is an explicit decision (the form sends nothing when
		// blank), so leave it for a human to review. Ari's decisions carry no account:
		// that null is the machine path whose default produced the zero.
		if (live.reviewerId !== null) {
			console.log(
				`${project.user?.email ?? project.userId} · ${project.title} (${phase.toLowerCase()}): manual 0h override, left for review`,
			)
			continue
		}
		const frozenHours = round2((live.frozenJournalHours ?? 0) + (live.frozenHackatimeHours ?? 0))
		if (frozenHours <= 0) continue

		const key = `${project.id}:${phase}`
		if (seen.has(key)) continue
		seen.add(key)

		const targets: Target[] = []
		let spendable = 0
		if (phase === Phase.DESIGN) {
			const tier = getTier(live.frozenTier ?? project.tier ?? project.requestedTier ?? 0)
			if (!tier) {
				console.log(`${project.user?.email ?? project.userId} · ${project.title}: no tier on the review, skipped`)
				continue
			}
			// The grant and funded block are read from the decision as it was actually recorded.
			// These approvals recorded no grant, so the tier's funded block is empty and every
			// approved hour pays – the same rule the programme applies to declined funding.
			const grantUsd = live.frozenGrantUsd ?? project.grantUsd ?? 0
			const fundedHours = live.frozenFundingHours ?? (grantUsd > 0 ? tier.fundingHours : 0)
			const { banked, spendable: hoursCoins } = designCoinsFor(tier.id, frozenHours, { fundedHours })
			spendable = hoursCoins
			targets.push(
				{ bucket: CoinBucket.BANKED, kind: LedgerKind.DESIGN_BANKED_HOURS, target: banked },
				{ bucket: CoinBucket.SPENDABLE, kind: LedgerKind.DESIGN_EXCESS_HOURS, target: hoursCoins },
			)
		} else {
			const { spendable: hoursCoins } = buildCoinsFor(frozenHours)
			spendable = hoursCoins
			// Warm-ups are pre-season practice and never earned the completion bonus.
			const bonus = project.theme === Theme.WARMUP ? 0 : THEME_COMPLETION_BONUS
			targets.push(
				{ bucket: CoinBucket.BANKED, kind: LedgerKind.BUILD_BANKED_HOURS, target: 0 },
				{ bucket: CoinBucket.SPENDABLE, kind: LedgerKind.BUILD_HOURS, target: hoursCoins },
				{ bucket: CoinBucket.SPENDABLE, kind: LedgerKind.THEME_COMPLETION_BONUS, target: bonus },
			)
		}

		const current = await ledgerTotal(
			project.id,
			project.userId,
			targets.map(target => target.kind),
		)
		const targetTotal = targets.reduce((sum, target) => sum + target.target, 0)

		repairs.push({
			correctedHours: frozenHours,
			current,
			delta: targetTotal - current,
			email: project.user?.email ?? project.userId,
			hours: live.frozenApprovedHours ?? 0,
			phase,
			projectId: project.id,
			reviewId: live.id,
			spendable,
			targets,
			title: project.title,
			userId: project.userId,
		})
	}

	const due = repairs.filter(repair => repair.delta > 0)
	for (const repair of repairs) {
		const state = repair.delta > 0 ? `short ${repair.delta}` : repair.delta === 0 ? "already correct" : "already above"
		console.log(
			`${repair.email} · ${repair.title} (${repair.phase.toLowerCase()}): frozen ${repair.hours}h, should be ${repair.correctedHours}h; paid ${repair.current}, owed ${repair.current + repair.delta} – ${state}`,
		)
	}

	let total = 0
	for (const repair of due) {
		total += repair.delta
		if (!apply) continue

		await db.transaction(async tx => {
			await lockUserCredit(tx, repair.userId)
			for (const target of repair.targets)
				await reconcileGrant(tx, {
					bucket: target.bucket,
					createdById: null,
					kind: target.kind,
					// The maker reads this in their coin history, so it names the cause rather than the bug.
					note: `Approval recorded at 0 hours on ${repair.title}: restored the ${repair.correctedHours}h that were logged`,
					target: target.target,
					themeProjectId: repair.projectId,
					userId: repair.userId,
				})

			// The approval's frozen hours are what every display and later reconcile reads back,
			// so they move with the ledger. Grants and tiers stay exactly as decided.
			await tx.orm.public.SubmissionReview.where({ id: repair.reviewId }).update({
				frozenApprovedHours: repair.correctedHours,
				frozenBankedCoins: 0,
				frozenSpendableCoins: repair.spendable,
			})
			await tx.orm.public.ThemeProject.where({ id: repair.projectId }).update(
				repair.phase === Phase.DESIGN
					? {
							designApprovedHours: repair.correctedHours,
							designBankedCoins: 0,
							designSpendableCoins: repair.spendable,
						}
					: {
							approvedHours: repair.correctedHours,
							buildCoins: repair.spendable,
						},
			)
		})
	}

	console.log(`\n${repairs.length} zero-hour approval(s) detected, ${due.length} short by ${total} coins in total.`)
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
