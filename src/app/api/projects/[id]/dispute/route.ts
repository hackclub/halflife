import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { projectDisplayTitle } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { notifyStaffDispute } from "@/lib/notifications"
import { statusFor } from "@/lib/phase"
import db, { isUniqueViolation } from "@/lib/prisma8"
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
export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, disputeSchema)
	if (parsed.error) return parsed.error
	const { phase } = parsed.data
	// Stored as plain text elsewhere, so it is stripped of markup on the way in too.
	const note = sanitize(parsed.data.note)

	const project = await db.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
		.select("id", "theme", "title")
		.first()
	if (!project) return fail("NOT_FOUND", "Project not found")

	// Wrap the status check, submission selection and dispute creation in one transaction so a dispute cannot attach to a submission that has since been resolved superseded or a phase that has since moved.
	const submissionId = await db.transaction(async tx => {
		const fresh = await tx.orm.public.ThemeProject.where({ deletedAt: null, id, userId: gate.user.id })
			.select("buildStatus", "designStatus")
			.first()
		if (!fresh) throw new HttpError("NOT_FOUND", "Project not found")

		const status = statusFor(fresh, phase)
		if (status !== "update_requested" && status !== "rejected")
			throw new HttpError("CONFLICT", "Only a review that asked for changes or rejected the work can be disputed")

		const submission = await tx.orm.public.PhaseSubmission.where({ phase, themeProjectId: id })
			.where(s => s.resolvedAt.isNotNull())
			.orderBy(s => s.resolvedAt.desc())
			.select("id")
			.first()
		if (!submission) throw new HttpError("NOT_FOUND", "There is no decided submission to dispute")

		try {
			await tx.orm.public.ReviewDispute.create({ note, submissionId: submission.id, userId: gate.user.id })
		} catch (err) {
			// The unique submissionId is the guard: one second look per decision. Anything else – a dropped connection, a constraint that is not this one – is not the caller's conflict to be told about.
			if (isUniqueViolation(err))
				throw new HttpError("CONFLICT", "You have already asked for a second look at this review")
			throw err
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
