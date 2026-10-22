import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { statusFor } from "@/lib/phase"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, isPhaseDecided, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"

interface Params {
	params: Promise<{ id: string; linkId: string }>
}

/** Statuses in which a phase's links may still be removed: a draft, or one an admin or reviewer sent back for changes. */
const EDITABLE_PHASE_STATUSES = [PhaseStatus.draft, PhaseStatus.update_requested]

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id, linkId } = await params

	const link = await prisma.hackatimeLink.findFirst({
		include: { themeProject: { select: { buildStatus: true, designStatus: true } } },
		where: {
			id: linkId,
			themeProject: { deletedAt: null, userId: gate.user.id },
			themeProjectId: id,
		},
	})
	if (!link) return fail("NOT_FOUND", "Link not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	// Removing a link is a correction to the record, so it freezes with the phase: while a reviewer is deciding, the numbers have to sit still.
	const phaseStatus = statusFor(link.themeProject, link.phase)
	if (phaseStatus === PhaseStatus.in_review)
		return fail("PHASE_LOCKED", "This phase is in review – unsubmit it before removing its links")
	// A decided phase is frozen: removing a link changes a number that has already been judged, so it waits for a return or an un-approval.
	if (isPhaseDecided(phaseStatus))
		return fail("PHASE_LOCKED", "This phase has been submitted and decided, so its links are final")

	// A reviewer-set override is part of a decision; removing the link would silently drop hours someone was already credited for.
	if (link.hoursApproved !== null) return fail("PHASE_LOCKED", "A reviewer has set hours on this link")

	// Conditional on the phase still being editable and the link still unreviewed: a submit or a decision that commits between the checks above and this delete makes it match nothing, and the link stays.
	const removed = await prisma.hackatimeLink.deleteMany({
		where: {
			hoursApproved: null,
			id: linkId,
			OR: [
				{ phase: Phase.DESIGN, themeProject: { designStatus: { in: EDITABLE_PHASE_STATUSES } } },
				{ phase: Phase.BUILD, themeProject: { buildStatus: { in: EDITABLE_PHASE_STATUSES } } },
			],
			themeProjectId: id,
		},
	})
	if (removed.count !== 1) return fail("PHASE_LOCKED", "This phase moved while its link was being removed")

	await logAudit({
		action: AuditAction.USER_UNLINK_HACKATIME,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { hackatimeProject: link.hackatimeProject, themeProjectId: id },
		targetId: linkId,
		targetType: "HackatimeLink",
	})

	return ok({ ok: true })
})
