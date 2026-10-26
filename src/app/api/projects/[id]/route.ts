import { and } from "@prisma/orm-postgres/orm-client"
import { markProjectCreated, recomputeActiveDays, recomputeWeek } from "@/lib/analytics"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { starterProjectsFor } from "@/lib/config/onboarding"
import { getThemeDef } from "@/lib/config/program"
import { Phase, PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withSession } from "@/lib/guards"
import { getHoursBreakdown } from "@/lib/hours"
import db from "@/lib/prisma8"
import {
	FROZEN_PHASE_STATUSES,
	getSubmissionAccess,
	projectEditLockReason,
	SUBMISSIONS_CLOSED_MESSAGE,
} from "@/lib/program"
import { deleteBlockReason } from "@/lib/project-delete"
import { withFields } from "@/lib/rows"
import { sanitize, sanitizeOptional } from "@/lib/sanitize"
import { projectUpdateSchema } from "@/lib/schemas/project"
import { recomputeStreak } from "@/lib/streak"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { isOwnedKey, publicUrlFor } from "@/lib/uploads/r2"

interface Params {
	params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const row = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.include("hackatimeLinks")
		.include("submissions", submissions => submissions.orderBy(s => s.createdAt.desc()).limit(10))
		.include("workSessions", sessions =>
			sessions
				.where({ deletedAt: null })
				.orderBy(session => session.createdAt.desc())
				.include("media")
				.include("timelapses"),
		)
		.first()
	// 404 rather than 403 for someone else's project: don't leak the ID space.
	if (!row) return fail("NOT_FOUND", "Project not found")

	const [design, build] = await Promise.all([
		getHoursBreakdown(row.id, Phase.DESIGN),
		getHoursBreakdown(row.id, Phase.BUILD),
	])

	// Prisma 8 reads timestamps as PostgreSQL text; the page works in Dates, so parse them at the boundary.
	const parseNullable = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))
	const parseList = <T extends { createdAt: string }>(
		rows: readonly T[],
	): (Omit<T, "createdAt"> & { createdAt: Date })[] =>
		rows.map(r => withFields(r, { createdAt: parseDbTimestamp(r.createdAt) }))
	const project = withFields(row, {
		approvedHoursAt: parseNullable(row.approvedHoursAt),
		buildReviewedAt: parseNullable(row.buildReviewedAt),
		createdAt: parseDbTimestamp(row.createdAt),
		deletedAt: parseNullable(row.deletedAt),
		designApprovedHoursAt: parseNullable(row.designApprovedHoursAt),
		designReviewedAt: parseNullable(row.designReviewedAt),
		grantEmittedAt: parseNullable(row.grantEmittedAt),
		hackatimeLinks: row.hackatimeLinks.map(link =>
			withFields(link, {
				cachedAt: parseNullable(link.cachedAt),
				createdAt: parseDbTimestamp(link.createdAt),
				reviewedAt: parseNullable(link.reviewedAt),
				spansFetchedAt: parseNullable(link.spansFetchedAt),
			}),
		),
		namedAt: parseNullable(row.namedAt),
		submissionExtensionUntil: parseNullable(row.submissionExtensionUntil),
		submissions: parseList(row.submissions).map(submission =>
			withFields(submission, { resolvedAt: parseNullable(submission.resolvedAt) }),
		),
		updatedAt: parseDbTimestamp(row.updatedAt),
		workSessions: parseList(row.workSessions).map(session =>
			withFields(session, {
				deletedAt: parseNullable(session.deletedAt),
				media: parseList(session.media).map(m => withFields(m, { url: publicUrlFor(m.objectKey) })),
				reviewedAt: parseNullable(session.reviewedAt),
				timelapses: session.timelapses.map(timelapse =>
					withFields(timelapse, {
						createdAt: parseDbTimestamp(timelapse.createdAt),
						recordedAt: parseNullable(timelapse.recordedAt),
					}),
				),
			}),
		),
	})

	// Reviewer anonymity: the IDs below name the (often teen) reviewer who decided a phase or entry. Nothing on the maker's side reads them – the page shows decisions, never deciders – so they are stripped before responding. Keep this list in sync with any new reviewer-attribution column: the default here is "entire row", which is how they leaked.
	const { buildReviewedById: _buildReviewer, designReviewedById: _designReviewer, ...safeProject } = project
	void _buildReviewer
	void _designReviewer
	const safeSessions = safeProject.workSessions.map(({ reviewedById: _sessionReviewer, ...session }) => {
		void _sessionReviewer
		return session
	})
	const safeLinks = safeProject.hackatimeLinks.map(({ reviewedById: _linkReviewer, ...link }) => {
		void _linkReviewer
		return link
	})

	return ok({
		hours: { build, design },
		project: {
			...safeProject,
			coverImageUrl: publicUrlFor(project.coverImageKey),
			hackatimeLinks: safeLinks,
			workSessions: safeSessions,
		},
		theme: getThemeDef(project.theme),
	})
})

export const PATCH = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, projectUpdateSchema)
	if (parsed.error) return parsed.error
	const { data } = parsed

	// A patch with no fields in it has nothing to write, and an update with nothing in it is not something the database can apply.
	if (Object.keys(data).length === 0) return fail("VALIDATION_FAILED", "Nothing to change")

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id }).first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	// Editing the thing a reviewer is currently reading changes what they are deciding on halfway through.
	if (project.designStatus === PhaseStatus.in_review || project.buildStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "A phase is in review, so unsubmit before editing")

	// A starter can only be taken if it is one of this week's: anyone may switch to one from the project page after creation, beginner or not – the tier-1 scoping below is what keeps a starter a starter, not who was offered it during onboarding.
	if (data.starterProjectId) {
		const offered = starterProjectsFor(project.theme)
		if (!offered.some(p => p.id === data.starterProjectId))
			return fail("VALIDATION_FAILED", "That is not one of this week's starter projects")
	}
	// The starter the project will have after this request, since the same request may be the one taking it or dropping it.
	const starterAfter = data.starterProjectId !== undefined ? data.starterProjectId : project.starterProjectId

	// The project page promises the tier is final once the design week is handed in, and a starter project is scoped to tier 1 from the start. Hold the server to the same promise rather than trusting the picker to be hidden.
	if (data.requestedTier !== undefined && data.requestedTier !== project.requestedTier) {
		if (project.designStatus === PhaseStatus.approved)
			return fail("PHASE_LOCKED", "The design week is approved, so the tier is final")
		if (starterAfter !== null && data.requestedTier !== 1)
			return fail("VALIDATION_FAILED", "Starter projects are fixed to tier 1")
	}

	// A decided phase is frozen: what the decision was made against is the record, so the details cannot be rewritten under it. Said after the tier rule above, which is the more specific answer to the same refusal.
	const editLock = projectEditLockReason(project)
	if (editLock) return fail("PHASE_LOCKED", editLock)

	// Taking a starter without also asking for tier 1 would leave a starter at a bigger tier, which the check above only catches when the tier changes.
	if (data.starterProjectId && (data.requestedTier ?? project.requestedTier) !== 1)
		return fail("VALIDATION_FAILED", "Starter projects are fixed to tier 1")

	// A cover is a key, and a key is a path into the bucket: only one this user uploaded as a cover, or a project could point its cover at anyone's file. `isOwnedKey` refuses path tricks (`..`, `%2e%2e`); the prefix pins it to the covers folder, so a key genuinely yours but uploaded as session evidence cannot be re-filed as a cover.
	if (
		data.coverImageKey
		&& (!isOwnedKey(gate.user.id, data.coverImageKey) || !data.coverImageKey.startsWith("covers/"))
	)
		return fail("VALIDATION_FAILED", "Upload the cover image first")

	// Conditional on the state just checked, so a submit or a decision that lands between the read above and this write is not edited out from under the reviewer reading it. It carries the ownership check and the live-row check with it, so a project that was deleted or handed to somebody else in the meantime is not written either.
	const updated = await db.transaction(async tx => {
		const claimed = await tx.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
			.where(row => and(row.buildStatus.notIn(FROZEN_PHASE_STATUSES), row.designStatus.notIn(FROZEN_PHASE_STATUSES)))
			.updateAndCount({
				...(data.title !== undefined ? { title: sanitize(data.title) } : {}),
				...(data.description !== undefined ? { description: sanitizeOptional(data.description) } : {}),
				...(data.githubRepo !== undefined ? { githubRepo: data.githubRepo } : {}),
				// `requestedTier`, never `tier`. The assigned tier is a reviewer's call at design approval because it decides parts money, and letting this route write it would let anyone grant themselves $100.
				...(data.requestedTier !== undefined ? { requestedTier: data.requestedTier } : {}),
				...(data.starterProjectId !== undefined ? { starterProjectId: data.starterProjectId } : {}),
				...(data.coverImageKey !== undefined ? { coverImageKey: data.coverImageKey } : {}),
				...(data.artifactLinks !== undefined
					? {
							artifactLinks: data.artifactLinks.map(l => ({
								label: sanitize(l.label),
								url: l.url,
							})),
						}
					: {}),
			})
		if (claimed !== 1) return null
		return tx.orm.public.ThemeProject.whereUnique({ id }).first()
	})
	if (!updated) return fail("PHASE_LOCKED", "This project just changed. Reload and try again")

	// A project counts as started once it has a description and a tier; the row itself has existed since sign-up.
	await markProjectCreated(id, gate.user.id)

	await logAudit({
		action: AuditAction.USER_UPDATE_PROJECT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			after: { githubRepo: updated.githubRepo, starterProjectId: updated.starterProjectId, title: updated.title },
			before: { githubRepo: project.githubRepo, starterProjectId: project.starterProjectId, title: project.title },
		},
		targetId: id,
		targetType: "ThemeProject",
	})

	return ok({ project: updated })
})

/**
 * Delete a project: a soft delete, so the row and its record stay for audit and every read that filters on `deletedAt` stops seeing it. What may be deleted is `deleteBlockReason`'s call, shared with the page.
 */
export const DELETE = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.select("buildStatus", "designStatus", "grantEmittedAt", "id", "theme", "title")
		.first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	const blocked = await deleteBlockReason({
		...project,
		grantEmittedAt: project.grantEmittedAt ? parseDbTimestamp(project.grantEmittedAt) : null,
	})
	if (blocked) return fail("PHASE_LOCKED", blocked)

	// Its entries stop counting with it, so the weeks they fell in are recounted.
	const weeks = await db.orm.public.WorkSession.where({ deletedAt: null, themeProjectId: id })
		.distinct("weekNumber")
		.select("weekNumber")
		.all()

	const deleted = await db.transaction(async tx => {
		// Re-read the project and its block status inside the transaction, so a grant, top-up, or dispute committing in the window is caught before the soft delete rather than after.
		const fresh = await tx.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
			.select("buildStatus", "designStatus", "grantEmittedAt", "id")
			.first()
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")
		const stillBlocked = await deleteBlockReason(
			{
				...fresh,
				grantEmittedAt: fresh.grantEmittedAt ? parseDbTimestamp(fresh.grantEmittedAt) : null,
			},
			tx,
		)
		if (stillBlocked) throw new HttpError("PHASE_LOCKED", stillBlocked)

		// Conditional on the statuses just checked, so a submit that lands between the check and here is not deleted out from under its reviewer.
		const nowText = formatDbTimestamp(new Date())
		const count = await tx.orm.public.ThemeProject.where({ deletedAt: null, id })
			.where(row =>
				and(
					row.buildStatus.notIn([PhaseStatus.in_review, PhaseStatus.approved]),
					row.designStatus.notIn([PhaseStatus.in_review, PhaseStatus.approved]),
				),
			)
			.updateAndCount({ deletedAt: nowText, deletedById: gate.user.id })
		if (count > 0) {
			// Its sessions go with it, so their timelapses are free to back a new project's entries (the taken-check ignores deleted sessions) and no query that only filters sessions on `deletedAt` keeps counting them.
			await tx.orm.public.WorkSession.where({ deletedAt: null, themeProjectId: id }).updateAll({
				deletedAt: nowText,
			})
			// The streak only counts days journalled on live projects.
			await recomputeStreak(tx, gate.user.id)
		}
		return count > 0
	})
	if (!deleted) return fail("PHASE_LOCKED", "This project just changed. Reload and try again")

	await logAudit({
		action: AuditAction.USER_DELETE_PROJECT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { theme: project.theme, title: project.title },
		targetId: id,
		targetType: "ThemeProject",
	})

	for (const { weekNumber } of weeks) await recomputeWeek(gate.user.id, weekNumber)
	await recomputeActiveDays(gate.user.id)

	return ok({ ok: true })
})
