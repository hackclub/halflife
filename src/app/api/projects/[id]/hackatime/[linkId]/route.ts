import { PhaseStatus } from "@/app/generated/prisma/enums"
import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { getSubmissionAccess, isPhaseDecided, SUBMISSIONS_CLOSED_MESSAGE } from "@/lib/program"

type Params = { params: Promise<{ id: string; linkId: string }> }

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id, linkId } = await params

	const link = await prisma.hackatimeLink.findFirst({
		where: {
			id: linkId,
			themeProjectId: id,
			themeProject: { userId: gate.user.id, deletedAt: null },
		},
		include: { themeProject: { select: { designStatus: true, buildStatus: true } } },
	})
	if (!link) return fail("NOT_FOUND", "Link not found")

	const access = await getSubmissionAccess(gate.user.id, id)
	if (!access.open) return fail("SUBMISSIONS_CLOSED", SUBMISSIONS_CLOSED_MESSAGE)

	// Removing a link is a correction to the record, so it freezes with the phase: while a reviewer is deciding, the numbers have to sit still.
	const phaseStatus = link.phase === "DESIGN" ? link.themeProject.designStatus : link.themeProject.buildStatus
	if (phaseStatus === PhaseStatus.in_review) {
		return fail("PHASE_LOCKED", "This phase is in review – unsubmit it before removing its links")
	}
	// A decided phase is frozen: removing a link changes a number that has already been judged, so it waits for a return or an un-approval.
	if (isPhaseDecided(phaseStatus)) {
		return fail("PHASE_LOCKED", "This phase has been submitted and decided, so its links are final")
	}

	// A reviewer-set override is part of a decision; removing the link would silently drop hours someone was already credited for.
	if (link.hoursApproved !== null) {
		return fail("PHASE_LOCKED", "A reviewer has set hours on this link")
	}

	await prisma.hackatimeLink.delete({ where: { id: linkId } })

	await logAudit({
		action: AuditAction.USER_UNLINK_HACKATIME,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "HackatimeLink",
		targetId: linkId,
		metadata: { themeProjectId: id, hackatimeProject: link.hackatimeProject },
	})

	return ok({ ok: true })
})
