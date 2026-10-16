import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { projectDisplayTitle } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { requireSession } from "@/lib/guards"
import { notifyStaffDispute } from "@/lib/notifications"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { disputeSchema } from "@/lib/schemas/project"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * A maker asking for a second look at a review.
 *
 * It changes no state: the phase stays returned or rejected. It records the maker's own words against the submission and puts it in front of staff, so a decision is never silently overridden by a button – and, because `ReviewDispute.submissionId` is unique, neither is the queue flooded.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, disputeSchema)
	if (parsed.error) return parsed.error
	const { phase } = parsed.data
	// Stored as plain text elsewhere, so it is stripped of markup on the way in too.
	const note = sanitize(parsed.data.note)

	const project = await prisma.themeProject.findFirst({
		select: { id: true, theme: true, title: true },
		where: { deletedAt: null, id, userId: gate.user.id },
	})
	if (!project) return fail("NOT_FOUND", "Project not found")

	// Wrap the status check, submission selection and dispute creation in one transaction so a dispute cannot attach to a submission that has since been resolved superseded or a phase that has since moved.
	const submissionId = await prisma.$transaction(async tx => {
		const fresh = await tx.themeProject.findFirst({
			select: { buildStatus: true, designStatus: true },
			where: { deletedAt: null, id, userId: gate.user.id },
		})
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")

		const status = phase === "DESIGN" ? fresh.designStatus : fresh.buildStatus
		if (status !== "update_requested" && status !== "rejected")
			throw new HttpError("CONFLICT", "Only a review that asked for changes or rejected the work can be disputed")

		const submission = await tx.phaseSubmission.findFirst({
			orderBy: { resolvedAt: "desc" },
			select: { id: true },
			where: { phase, resolvedAt: { not: null }, themeProjectId: id },
		})
		if (!submission) throw new HttpError("NOT_FOUND", "There is no decided submission to dispute")

		try {
			await tx.reviewDispute.create({
				data: { note, submissionId: submission.id, userId: gate.user.id },
			})
		} catch {
			// The unique submissionId is the guard: one second look per decision.
			throw new HttpError("CONFLICT", "You have already asked for a second look at this review")
		}

		return submission.id
	})

	await logAudit({
		action: AuditAction.USER_DISPUTE_REVIEW,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { phase, submissionId },
		targetId: id,
		targetType: "ThemeProject",
	})

	await notifyStaffDispute({
		note,
		participant: gate.user.name ?? gate.user.email,
		phase,
		submissionId,
		themeProjectId: id,
		title: projectDisplayTitle(project),
	})

	return ok({ disputed: true }, { status: 201 })
})
