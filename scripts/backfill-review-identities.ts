import "dotenv/config"
import { AuditAction } from "../src/app/generated/prisma/enums"
import prisma from "../src/lib/prisma"

/**
 * Fill in who decided what on past reviews, so the review leaderboard can credit Ari's reviewers.
 *
 * `SubmissionReview.reviewerId` is null for every Ari decision by design, and the column that carries the person (`reviewerEmail`) only started being written when it was added – so every earlier review has neither, and the board tallies nothing. The identity was never lost, though: `finalizeReview` logs a REVIEW_APPROVE/RETURN/REJECT audit row per decision with the reviewer's address and the submission id, for console and Ari decisions alike. This replays those rows onto the reviews. Console reviews additionally fall back to their reviewer's account email.
 *
 * Safe to run again: rows that already carry an address are skipped, and each review takes the latest matching audit row, so an un-approve followed by a re-decision attributes the review to the decision that actually stands.
 */
const BATCH = 500

async function main() {
	const candidates = await prisma.submissionReview.findMany({
		select: { createdAt: true, id: true, reviewerId: true, submissionId: true },
		where: { reviewerEmail: null },
	})
	console.log(`reviews without an address: ${candidates.length}`)
	if (candidates.length === 0) return

	// Console reviewers are identified by their account, no audit read needed.
	const reviewerIds = [...new Set(candidates.flatMap(r => (r.reviewerId ? [r.reviewerId] : [])))]
	const usersById = new Map(
		(
			await prisma.user.findMany({
				select: { email: true, id: true },
				where: { id: { in: reviewerIds } },
			})
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
					await prisma.submissionReview.update({
						data: { reviewerEmail: accountEmail },
						where: { id: review.id },
					})
					filled += 1
					return
				}
				// Otherwise the latest decision audit for this submission – one row per decision, so a re-decision after an un-approval attributes what stands.
				const audit = await prisma.auditLog.findFirst({
					orderBy: [{ createdAt: "desc" }, { id: "desc" }],
					select: { actorEmail: true },
					where: {
						action: { in: [AuditAction.REVIEW_APPROVE, AuditAction.REVIEW_RETURN, AuditAction.REVIEW_REJECT] },
						metadata: { equals: review.submissionId, path: ["submissionId"] },
					},
				})
				if (audit?.actorEmail) {
					await prisma.submissionReview.update({
						data: { reviewerEmail: audit.actorEmail },
						where: { id: review.id },
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
	await prisma.$disconnect()
}
