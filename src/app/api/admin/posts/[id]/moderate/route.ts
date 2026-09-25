import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { hidePost, restorePost } from "@/lib/feed"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { moderatePostSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Hide a reel. */
export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_FEED)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, moderatePostSchema)
  if (parsed.error) return parsed.error

  await hidePost(id, gate.user.id, parsed.data.reason)

  await logAudit({
    action: AuditAction.ADMIN_HIDE_POST,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "Post",
    targetId: id,
    metadata: { reason: parsed.data.reason },
  })

  return ok({ hidden: true })
})

/** Put it back. */
export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_FEED)
  if (gate.error) return gate.error
  const { id } = await params

  await restorePost(id)

  await logAudit({
    action: AuditAction.ADMIN_RESTORE_POST,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "Post",
    targetId: id,
  })

  return ok({ restored: true })
})
