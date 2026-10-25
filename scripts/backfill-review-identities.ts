import "dotenv/config"
import { AuditAction } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Fill in who decided what on past reviews, so the review leaderboard can credit Ari's reviewers.
 *
 * `SubmissionReview.reviewerId` is null for every Ari decision by design, and the column that carries the person (`reviewerEmail`) only started being written when it was added – so every earlier review has neither, and the board tallies nothing. The identity was never lost, though: `finalizeReview` logs a REVIEW_APPROVE/RETURN/REJECT audit row per decision with the reviewer's address and the submission id, for console and Ari decisions alike. This replays those rows onto the reviews. Console reviews additionally fall back to their reviewer's account email.
 *
 * Safe to run again: rows that already carry an address are skipped, and each review takes the latest matching audit row, so an un-approve followed by a re-decision attributes the review to the decision that actually stands.
 */
const BATCH = 500

async function main() {
	const candidates = await db.orm.public.SubmissionReview.where({ reviewerEmail: null })
		.select("createdAt", "id", "reviewerId", "submissionId")
		.all()
	console.log(`reviews without an address: ${candidates.length}`)
	if (candidates.length === 0) return

	// Console reviewers are identified by their account, no audit read needed.
	const reviewerIds = [...new Set(candidates.flatMap(r => (r.reviewerId ? [r.reviewerId] : [])))]
	const usersById = new Map(
		(
			await db.orm.public.User.where(user => user.id.in(reviewerIds))
				.select("email", "id")
				.all()
		).map(u => [u.id, u.email]),
	)

	let filled = 0
	let stillBlank = 0
	for (let i = 0; i < candidates.length; i += BATCH) {
		const batch = candidates.slice(i, i + BATCH)
		await Promise.all(
			batch.map(async review => {
				// The account first: a console reviewer's address is their own, whatever the audit rows say.
				const accountEmail = review.reviewerId ? usersById.get(review.reviewerId) : null
				if (accountEmail) {
					await db.orm.public.SubmissionReview.where({ id: review.id }).update({
						reviewerEmail: accountEmail,
					})
					filled += 1
					return
				}
				// Otherwise the latest decision audit for this submission – one row per decision, so a re-decision after an un-approval attributes what stands. The audit's JSON carries the submission id, and the ORM has no JSON predicate, so this is one raw read rather than a scan of the whole log.
				const [audit] = await db.query(
					db.raw.sql`
						SELECT "actorEmail"
						FROM "audit_log"
						WHERE "action" IN (${AuditAction.REVIEW_APPROVE}, ${AuditAction.REVIEW_RETURN}, ${AuditAction.REVIEW_REJECT})
							AND "metadata"->>'submissionId' = ${review.submissionId}
						ORDER BY "createdAt" DESC, "id" DESC
						LIMIT 1
					`
						.returnsRow({ actorEmail: "pg/text@1" })
						.build(),
				)
				if (audit?.actorEmail) {
					await db.orm.public.SubmissionReview.where({ id: review.id }).update({
						reviewerEmail: audit.actorEmail,
					})
					filled += 1
				} else stillBlank += 1
			}),
		)
		console.log(
			`…${Math.min(i + BATCH, candidates.length)}/${candidates.length} (filled ${filled}, still blank ${stillBlank})`,
		)
	}
	console.log(`done: filled ${filled}, still blank ${stillBlank}`)
	if (stillBlank > 0)
		console.log(
			"Blank rows have no decision audit to read – pre-audit decisions, or anonymous Ari calls. The board counts them under Ari.",
		)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exitCode = 1
} finally {
	await db.close()
}
