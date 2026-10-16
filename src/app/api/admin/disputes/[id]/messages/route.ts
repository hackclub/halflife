import { after } from "next/server"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { notifyDisputeReply } from "@/lib/notifications"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { disputeMessageSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * A reviewer's reply in a dispute thread.
 *
 * The maker is told a reply exists, not the whole thread: the project page is the record. Replying does not close the dispute; a reviewer closes it or sends it back when they are done.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, disputeMessageSchema)
	if (parsed.error) return parsed.error

	const dispute = await prisma.reviewDispute.findUnique({
		select: { resolvedAt: true, submission: { select: { phase: true, themeProjectId: true } } },
		where: { id },
	})
	if (!dispute) return fail("NOT_FOUND", "Dispute not found")
	if (dispute.resolvedAt) return fail("CONFLICT", "That dispute is already resolved")

	const message = await prisma.reviewDisputeMessage.create({
		data: { authorId: gate.user.id, body: sanitize(parsed.data.body), disputeId: id, fromReviewer: true },
	})

	after(() =>
		notifyDisputeReply({
			body: message.body,
			phase: dispute.submission.phase,
			themeProjectId: dispute.submission.themeProjectId,
		}),
	)

	return ok({ id: message.id }, { status: 201 })
})
