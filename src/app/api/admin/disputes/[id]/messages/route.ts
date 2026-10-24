import { after } from "next/server"
import { fail, ok, parseBody } from "@/lib/api"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { notifyDisputeReply } from "@/lib/notifications"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
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
export const POST = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, disputeMessageSchema)
		if (parsed.error) return parsed.error

		const dispute = await db.orm.public.ReviewDispute.whereUnique({ id })
			.select("resolvedAt")
			.include("submission", submission => submission.select("phase", "themeProjectId"))
			.first()
		if (!dispute?.submission) return fail("NOT_FOUND", "Dispute not found")
		if (dispute.resolvedAt) return fail("CONFLICT", "That dispute is already resolved")
		const { submission } = dispute

		const message = await db.orm.public.ReviewDisputeMessage.create({
			authorId: gate.user.id,
			body: sanitize(parsed.data.body),
			disputeId: id,
			fromReviewer: true,
		})

		after(() =>
			notifyDisputeReply({
				body: message.body,
				phase: submission.phase,
				themeProjectId: submission.themeProjectId,
			}),
		)

		return ok({ id: message.id }, { status: 201 })
	},
)
