import { Prisma } from "@/app/generated/prisma/client"
import { fail, ok, parseBody, rateLimitedInMemory, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { REPORT_TARGET_LABELS, type ReportTarget } from "@/lib/reports"
import { createReportSchema } from "@/lib/schemas/report"

export const dynamic = "force-dynamic"

/**
 * A participant flagging a reel, reel comment, project, user or devlog for
 * staff.
 *
 * It changes no state: the row stays up and the queue gains a row. Taking
 * something down stays a separate admin action, so a report is never a
 * silent takedown — and, because an open report per reporter per row is the
 * most the queue holds, neither is it a flood.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, createReportSchema)
	if (parsed.error) return parsed.error
	const { target, targetId, reason, details } = parsed.data

	if (rateLimitedInMemory(`report:${gate.user.id}`, 10, 60_000)) {
		return fail("RATE_LIMITED", "Slow down a second, then try again.")
	}

	const label = REPORT_TARGET_LABELS[target as ReportTarget].toLowerCase()

	// The row has to exist, be live, and be someone else's. Each target reads
	// its own table; the author id is what the self-report and duplicate
	// guards below compare against.
	let authorId: string | null = null
	if (target === "REEL") {
		const post = await prisma.post.findUnique({
			where: { id: targetId },
			select: { userId: true, deletedAt: true, hiddenAt: true },
		})
		if (!post || post.deletedAt) return fail("NOT_FOUND", "That reel no longer exists")
		if (post.hiddenAt) return fail("CONFLICT", "That reel was already taken down")
		authorId = post.userId
	} else if (target === "REEL_COMMENT") {
		const comment = await prisma.postComment.findUnique({
			where: { id: targetId },
			select: { userId: true, deletedAt: true, hiddenAt: true },
		})
		if (!comment || comment.deletedAt) return fail("NOT_FOUND", "That comment no longer exists")
		if (comment.hiddenAt) return fail("CONFLICT", "That comment was already taken down")
		authorId = comment.userId
	} else if (target === "PROJECT") {
		const project = await prisma.themeProject.findFirst({
			where: { id: targetId, deletedAt: null },
			select: { userId: true },
		})
		if (!project) return fail("NOT_FOUND", "That project no longer exists")
		authorId = project.userId
	} else if (target === "USER") {
		const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } })
		if (!user) return fail("NOT_FOUND", "That user no longer exists")
		authorId = user.id
	} else {
		const session = await prisma.workSession.findFirst({
			where: { id: targetId, deletedAt: null, themeProject: { deletedAt: null } },
			select: { themeProject: { select: { userId: true } } },
		})
		if (!session) return fail("NOT_FOUND", "That entry no longer exists")
		authorId = session.themeProject.userId
	}

	if (authorId === gate.user.id) return fail("CONFLICT", `You cannot report your own ${label}`)

	// One open report per reporter per row: a second press while staff have
	// not looked yet is a duplicate, not a new report. A decided one may be
	// reported again — something can get worse after it was cleared.
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
	const dupe = await prisma.contentReport.findFirst({
		where: { reporterId: gate.user.id, target, status: "OPEN", ...field },
		select: { id: true },
	})
	if (dupe) return fail("CONFLICT", `You have already reported this ${label} — staff will take a look`)

	// The friendly check above races a second press in flight: the partial
	// unique indexes are the real guard, and their violation reads as the
	// same conflict rather than a 500.
	let report: { id: string }
	try {
		report = await prisma.contentReport.create({
			data: {
				reporterId: gate.user.id,
				target,
				reason,
				details: details?.trim() ? details.trim() : null,
				...field,
			},
			select: { id: true },
		})
	} catch (err) {
		if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
			return fail("CONFLICT", `You have already reported this ${label} — staff will take a look`)
		}
		throw err
	}

	await logAudit({
		action: AuditAction.USER_CREATE_REPORT,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
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
		targetId,
		metadata: { reportId: report.id, reason },
	})

	return ok({ reported: true }, { status: 201 })
})
