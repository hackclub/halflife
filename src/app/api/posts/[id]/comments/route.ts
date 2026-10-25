import type { NextRequest } from "next/server"
import { fail, ok, parseBody, parseQuery, rateLimitedInMemory } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { addComment, getComments } from "@/lib/feed"
import { type AuthedContext, withSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { commentSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

export const GET = withSession(async (req: NextRequest, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = parseQuery(req, paginationQuery)
	if (parsed.error) return parsed.error

	return ok(await getComments(id, gate.user.id, { cursor: parsed.data.cursor, limit: parsed.data.limit }))
})

export const POST = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, commentSchema)
	if (parsed.error) return parsed.error

	// Spam brake: ten comments a minute per account. In-memory per instance like every other app rate limit (see lib/rate-limit), so it stops one account flooding the feed, not a distributed attack.
	if (rateLimitedInMemory(`comment:${gate.user.id}`)) return fail("RATE_LIMITED", "Slow down – try again in a moment")

	const comment = await addComment(id, gate.user.id, parsed.data.body)

	await logAudit({
		action: AuditAction.USER_COMMENT_POST,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { postId: id },
		targetId: comment.id,
		targetType: "PostComment",
	})

	return ok({ comment }, { status: 201 })
})
