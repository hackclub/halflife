import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { addComment, getComments } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"
import { commentSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export const GET = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  const url = new URL(req.url)
  const parsed = paginationQuery.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  })
  const { cursor, limit } = parsed.success ? parsed.data : { cursor: undefined, limit: 25 }

  return ok(await getComments(id, gate.user.id, { cursor, limit }))
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
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "PostComment",
    targetId: comment.id,
    metadata: { postId: id },
  })

  return ok({ comment }, { status: 201 })
})
