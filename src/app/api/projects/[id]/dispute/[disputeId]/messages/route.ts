import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { projectDisplayTitle } from "@/lib/config/program"
import { type AuthedContext, withSession } from "@/lib/guards"
import { notifyStaffDispute } from "@/lib/notifications"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { disputeMessageSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ disputeId: string; id: string }>
}

/**
 * A maker's reply in the thread on their own dispute.
 *
 * Scoped through the project so one maker's dispute id cannot be written to from another's session. A reply pings staff the same way the original dispute did, so a maker answering a reviewer's question is not left waiting on a channel nobody is reading.
 */
export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { disputeId, id } = await params

	const parsed = await parseBody(req, disputeMessageSchema)
	if (parsed.error) return parsed.error

	const dispute = await prisma.reviewDispute.findFirst({
		select: {
			resolvedAt: true,
			submission: { select: { id: true, phase: true, themeProject: { select: { theme: true, title: true } } } },
		},
		where: { id: disputeId, submission: { themeProject: { deletedAt: null, id, userId: gate.user.id } } },
	})
	if (!dispute) return fail("NOT_FOUND", "Dispute not found")
	if (dispute.resolvedAt) return fail("CONFLICT", "That dispute is already resolved")

	const message = await prisma.reviewDisputeMessage.create({
		data: { authorId: gate.user.id, body: sanitize(parsed.data.body), disputeId, fromReviewer: false },
	})

	after(() =>
		notifyStaffDispute({
			note: message.body,
			participant: gate.user.name ?? gate.user.email,
			phase: dispute.submission.phase,
			submissionId: dispute.submission.id,
			themeProjectId: id,
			title: projectDisplayTitle(dispute.submission.themeProject),
		}),
	)

	return ok({ id: message.id }, { status: 201 })
})
