import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { hideComment } from "@/lib/feed"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { moderatePostSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Hide a comment. Hiding only: a hidden comment is out of the feed and out of
 * the comment count, and there is no moderator-facing restore – the owner
 * cannot delete it either (that would decrement the count twice), so unhiding
 * would need a new pair of operations rather than a flag flip.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_FEED)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, moderatePostSchema)
	if (parsed.error) return parsed.error

	await hideComment(id, gate.user.id, parsed.data.reason)

	await logAudit({
		action: AuditAction.ADMIN_HIDE_COMMENT,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "PostComment",
		targetId: id,
		metadata: { reason: parsed.data.reason },
	})

	return ok({ hidden: true })
})
