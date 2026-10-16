import type { NextRequest } from "next/server"
import { ok, parseBody, parseQuery, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { addComment, getComments } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { commentSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

export const GET = withRoute(async (req: NextRequest, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = parseQuery(req, paginationQuery)
	if (parsed.error) return parsed.error

	return ok(await getComments(id, gate.user.id, { cursor: parsed.data.cursor, limit: parsed.data.limit }))
})

export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, commentSchema)
	if (parsed.error) return parsed.error

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
