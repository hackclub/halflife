import { and } from "@prisma/orm-postgres/orm-client"
import { after } from "next/server"
import { fail, ok, parseBody, rateLimitedInMemory } from "@/lib/api"
import { projectDisplayTitle } from "@/lib/config/program"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { notifyStaffDispute } from "@/lib/notifications"
import db from "@/lib/prisma8"
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
export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { disputeId, id } = await params

	const parsed = await parseBody(req, disputeMessageSchema)
	if (parsed.error) return parsed.error

	// Every reply pings staff on Slack, so the same ten-a-minute brake as feed comments applies.
	if (rateLimitedInMemory(`dispute-message:${gate.user.id}`))
		return fail("RATE_LIMITED", "Slow down. Try again in a moment")

	const dispute = await db.orm.public.ReviewDispute.where({ id: disputeId })
		.where(d =>
			d.submission.some(submission =>
				submission.themeProject.some(project =>
					and(project.deletedAt.isNull(), project.id.eq(id), project.userId.eq(gate.user.id)),
				),
			),
		)
		.select("resolvedAt")
		.include("submission", submission =>
			submission.select("id", "phase").include("themeProject", project => project.select("theme", "title")),
		)
		.first()
	if (!dispute?.submission?.themeProject) return fail("NOT_FOUND", "Dispute not found")
	if (dispute.resolvedAt) return fail("CONFLICT", "That dispute is already resolved")
	const submission = { ...dispute.submission, themeProject: dispute.submission.themeProject }

	const message = await db.orm.public.ReviewDisputeMessage.create({
		authorId: gate.user.id,
		body: sanitize(parsed.data.body),
		disputeId,
		fromReviewer: false,
	})

	after(() =>
		notifyStaffDispute({
			note: message.body,
			participant: gate.user.name ?? gate.user.email,
			phase: submission.phase,
			submissionId: submission.id,
			themeProjectId: id,
			title: projectDisplayTitle(submission.themeProject),
		}),
	)

	return ok({ id: message.id }, { status: 201 })
})
