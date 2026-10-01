import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { getThemeDef } from "@/lib/config/program"
import { requireSession } from "@/lib/guards"
import { notifyStaffDispute } from "@/lib/notifications"
import prisma from "@/lib/prisma"
import { disputeSchema } from "@/lib/schemas/project"

type Params = { params: Promise<{ id: string }> }

/**
 * A maker asking for a second look at a review.
 *
 * It changes no state: the phase stays returned or rejected. It records the
 * maker's own words against the submission and puts it in front of staff, so a
 * decision is never silently overridden by a button — and, because
 * `ReviewDispute.submissionId` is unique, neither is the queue flooded.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, disputeSchema)
	if (parsed.error) return parsed.error
	const { phase, note } = parsed.data

	const project = await prisma.themeProject.findFirst({
		where: { id, userId: gate.user.id, deletedAt: null },
		select: { id: true, title: true, theme: true, designStatus: true, buildStatus: true },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	const status = phase === "DESIGN" ? project.designStatus : project.buildStatus
	if (status !== "update_requested" && status !== "rejected") {
		return fail("CONFLICT", "Only a review that asked for changes or rejected the work can be disputed")
	}

	const submission = await prisma.phaseSubmission.findFirst({
		where: { themeProjectId: id, phase, resolvedAt: { not: null } },
		orderBy: { resolvedAt: "desc" },
		select: { id: true },
	})
	if (!submission) return fail("NOT_FOUND", "There is no decided submission to dispute")

	try {
		await prisma.reviewDispute.create({
			data: { submissionId: submission.id, userId: gate.user.id, note },
		})
	} catch {
		// The unique submissionId is the guard: one second look per decision.
		return fail("CONFLICT", "You have already asked for a second look at this review")
	}

	await logAudit({
		action: AuditAction.USER_DISPUTE_REVIEW,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ThemeProject",
		targetId: id,
		metadata: { phase, submissionId: submission.id },
	})

	await notifyStaffDispute({
		themeProjectId: id,
		title: project.title.trim() || getThemeDef(project.theme).label,
		phase,
		note,
		participant: gate.user.name ?? gate.user.email,
	})

	return ok({ disputed: true }, { status: 201 })
})
