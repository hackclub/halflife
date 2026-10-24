import { fail, ok, parseBody, rateLimitedInMemory } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withSession } from "@/lib/guards"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { REPORT_TARGET_LABELS, type ReportTarget } from "@/lib/reports"
import { createReportSchema } from "@/lib/schemas/report"

export const dynamic = "force-dynamic"

/**
 * A participant flagging a reel, reel comment, project, user or devlog for staff.
 *
 * It changes no state: the row stays up and the queue gains a row. Taking something down stays a separate admin action, so a report is never a silent takedown – and, because an open report per reporter per row is the most the queue holds, neither is it a flood.
 */
export const POST = withSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, createReportSchema)
	if (parsed.error) return parsed.error
	const { target, targetId, reason, details } = parsed.data

	if (rateLimitedInMemory(`report:${gate.user.id}`, 10, 60_000))
		return fail("RATE_LIMITED", "Slow down a second, then try again.")

	const label = REPORT_TARGET_LABELS[target as ReportTarget].toLowerCase()

	// The row has to exist, be live, and be someone else's. Each target reads its own table; the author id is what the self-report and duplicate guards below compare against.
	let authorId: string | null = null
	if (target === "REEL") {
		const post = await db.orm.public.Post.whereUnique({ id: targetId })
			.select("deletedAt", "hiddenAt", "userId")
			.first()
		if (!post || post.deletedAt) return fail("NOT_FOUND", "That reel no longer exists")
		if (post.hiddenAt) return fail("CONFLICT", "That reel was already taken down")
		authorId = post.userId
	} else if (target === "REEL_COMMENT") {
		const comment = await db.orm.public.PostComment.whereUnique({ id: targetId })
			.select("deletedAt", "hiddenAt", "userId")
			.first()
		if (!comment || comment.deletedAt) return fail("NOT_FOUND", "That comment no longer exists")
		if (comment.hiddenAt) return fail("CONFLICT", "That comment was already taken down")
		authorId = comment.userId
	} else if (target === "PROJECT") {
		const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id: targetId }).select("userId").first()
		if (!project) return fail("NOT_FOUND", "That project no longer exists")
		authorId = project.userId
	} else if (target === "USER") {
		const user = await db.orm.public.User.whereUnique({ id: targetId }).select("id").first()
		if (!user) return fail("NOT_FOUND", "That user no longer exists")
		authorId = user.id
	} else {
		const session = await db.orm.public.WorkSession.where({ deletedAt: null, id: targetId })
			.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
			.include("themeProject", project => project.select("userId"))
			.first()
		if (!session?.themeProject) return fail("NOT_FOUND", "That entry no longer exists")
		authorId = session.themeProject.userId
	}

	if (authorId === gate.user.id) return fail("CONFLICT", `You cannot report your own ${label}`)

	// One open report per reporter per row: a second press while staff have not looked yet is a duplicate, not a new report. A decided one may be reported again – something can get worse after it was cleared.
	const field =
		target === "REEL"
			? { postId: targetId }
			: target === "REEL_COMMENT"
				? { commentId: targetId }
				: target === "PROJECT"
					? { themeProjectId: targetId }
					: target === "USER"
						? { targetUserId: targetId }
						: { workSessionId: targetId }
	const dupe = await db.orm.public.ContentReport.where({ reporterId: gate.user.id, status: "OPEN", target, ...field })
		.select("id")
		.first()
	if (dupe) return fail("CONFLICT", `You have already reported this ${label} – staff will take a look`)

	// The friendly check above races a second press in flight: the partial unique indexes are the real guard, and their violation reads as the same conflict rather than a 500.
	let report: { id: string }
	try {
		report = await db.orm.public.ContentReport.create({
			details: details?.trim() ? details.trim() : null,
			reason,
			reporterId: gate.user.id,
			target,
			...field,
		})
	} catch (err) {
		if (isUniqueViolation(err))
			return fail("CONFLICT", `You have already reported this ${label} – staff will take a look`)
		throw err
	}

	await logAudit({
		action: AuditAction.USER_CREATE_REPORT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { reason, reportId: report.id },
		targetId,
		targetType:
			target === "REEL"
				? "Post"
				: target === "REEL_COMMENT"
					? "PostComment"
					: target === "PROJECT"
						? "ThemeProject"
						: target === "USER"
							? "User"
							: "WorkSession",
	})

	return ok({ reported: true }, { status: 201 })
})
