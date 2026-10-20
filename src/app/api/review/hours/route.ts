import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { lockUserCredit } from "@/lib/currency"
import { HttpError } from "@/lib/errors"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitizeOptional } from "@/lib/sanitize"
import { hoursDecisionSchema } from "@/lib/schemas/review"

/**
 * Batched, because a reviewer approves a whole project's hours in one pass and one request per entry would be a dozen round trips per review.
 *
 * These numbers feed `getHoursBreakdown` and therefore the payout, so the route is scoped to work actually awaiting review: every entry must belong to a phase that is `in_review`, and another reviewer's live claim refuses the whole batch. Without that, a REVIEW_HOURS holder could rewrite accepted hours on a draft project or after a decision, which a later un-approve/re-approve cycle would then pay against.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requirePermission(Permission.REVIEW_HOURS)
	if (gate.error) return gate.error

	const parsed = await parseBody(req, hoursDecisionSchema)
	if (parsed.error) return parsed.error

	const sessionIds = parsed.data.decisions.filter(d => d.kind === "session").map(d => d.id)
	const linkIds = parsed.data.decisions.filter(d => d.kind === "hackatime").map(d => d.id)
	const now = new Date()

	const applied = await prisma.$transaction(async tx => {
		const [sessions, links] = await Promise.all([
			sessionIds.length > 0
				? tx.workSession.findMany({
						select: {
							id: true,
							phase: true,
							themeProject: { select: { buildStatus: true, designStatus: true, userId: true } },
							themeProjectId: true,
						},
						where: { deletedAt: null, id: { in: sessionIds } },
					})
				: [],
			linkIds.length > 0
				? tx.hackatimeLink.findMany({
						select: {
							id: true,
							phase: true,
							themeProject: { select: { buildStatus: true, designStatus: true, userId: true } },
							themeProjectId: true,
						},
						where: { id: { in: linkIds } },
					})
				: [],
		])

		// All or nothing: a decision naming an entry that is gone is a stale page, not a partial success.
		if (sessions.length !== sessionIds.length || links.length !== linkIds.length)
			throw new HttpError("NOT_FOUND", "One of those entries no longer exists")

		// Approving hours is the other half of the money path, so it needs the same rule the decision route has: nobody rules on their own work.
		const all = [...sessions, ...links]
		if (all.some(row => row.themeProject.userId === gate.user.id))
			throw new HttpError("FORBIDDEN", "You cannot approve hours on your own work")

		// The same per-user credit lock the decision path takes. A decision freezes a total computed from
		// these very rows, so a batch that rewrote them without the lock could change the number a decision
		// is about to freeze. One lock per distinct user, because a batch can span several projects and
		// several people, taken in a fixed order so two batches covering the same people queue behind each
		// other instead of deadlocking.
		const userIds = [...new Set(all.map(row => row.themeProject.userId))].toSorted()
		for (const userId of userIds) await lockUserCredit(tx, userId)

		for (const row of all) {
			const status = row.phase === Phase.DESIGN ? row.themeProject.designStatus : row.themeProject.buildStatus
			if (status !== PhaseStatus.in_review)
				throw new HttpError("PHASE_LOCKED", "Hours can only be approved while the phase is in review")
		}

		// Ari owns its own decisions, but a claim another Half Life reviewer holds is theirs until it expires.
		const pairs = [...new Map(all.map(row => [`${row.themeProjectId}:${row.phase}`, row])).values()]
		const openSubmissions = await tx.phaseSubmission.findMany({
			select: { claim: { select: { expiresAt: true, reviewerId: true } } },
			where: {
				OR: pairs.map(row => ({ phase: row.phase, themeProjectId: row.themeProjectId })),
				resolvedAt: null,
			},
		})
		const blocked = openSubmissions.some(
			submission =>
				submission.claim && submission.claim.reviewerId !== gate.user.id && submission.claim.expiresAt > now,
		)
		if (blocked) throw new HttpError("CLAIMED_BY_OTHER", "Another reviewer is deciding this phase right now")

		const changes: { kind: string; id: string; before: number | null; after: number }[] = []

		for (const decision of parsed.data.decisions)
			if (decision.kind === "session") {
				const before = await tx.workSession.findUnique({
					select: { hoursApproved: true },
					where: { id: decision.id },
				})
				if (!before) throw new HttpError("NOT_FOUND", "One of those entries no longer exists")
				// Conditional on the phase still being in review: a decision or a withdrawal that commits between the checks above and this write makes it match nothing, and the batch rolls back.
				const updated = await tx.workSession.updateMany({
					data: {
						hoursApproved: decision.hoursApproved,
						reviewComments: sanitizeOptional(decision.comments),
						reviewedAt: now,
						reviewedById: gate.user.id,
					},
					where: {
						id: decision.id,
						OR: [
							{ phase: Phase.DESIGN, themeProject: { designStatus: PhaseStatus.in_review } },
							{ phase: Phase.BUILD, themeProject: { buildStatus: PhaseStatus.in_review } },
						],
					},
				})
				if (updated.count !== 1) throw new HttpError("PHASE_LOCKED", "The phase moved while its hours were approved")
				changes.push({
					after: decision.hoursApproved,
					before: before.hoursApproved,
					id: decision.id,
					kind: "session",
				})
			} else {
				const before = await tx.hackatimeLink.findUnique({
					select: { hoursApproved: true },
					where: { id: decision.id },
				})
				if (!before) throw new HttpError("NOT_FOUND", "One of those entries no longer exists")
				const updated = await tx.hackatimeLink.updateMany({
					data: {
						hoursApproved: decision.hoursApproved,
						reviewedAt: now,
						reviewedById: gate.user.id,
					},
					where: {
						id: decision.id,
						OR: [
							{ phase: Phase.DESIGN, themeProject: { designStatus: PhaseStatus.in_review } },
							{ phase: Phase.BUILD, themeProject: { buildStatus: PhaseStatus.in_review } },
						],
					},
				})
				if (updated.count !== 1) throw new HttpError("PHASE_LOCKED", "The phase moved while its hours were approved")
				changes.push({
					after: decision.hoursApproved,
					before: before.hoursApproved,
					id: decision.id,
					kind: "hackatime",
				})
			}

		return changes
	})

	await logAudit({
		action: AuditAction.REVIEW_APPROVE_HOURS,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { changes: applied },
		targetId: applied[0]?.id ?? null,
		targetType: "WorkSession",
	})

	return ok({ changes: applied, updated: applied.length })
})
