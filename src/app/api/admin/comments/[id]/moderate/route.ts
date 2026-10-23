import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { hideComment } from "@/lib/feed"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { moderatePostSchema } from "@/lib/schemas/feed"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Hide a comment. Hiding only: a hidden comment is out of the feed and out of the comment count, and there is no moderator-facing restore – the owner cannot delete it either (that would decrement the count twice), so unhiding would need a new pair of operations rather than a flag flip.
 */
export const POST = withPermission(
	Permission.MANAGE_FEED,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, moderatePostSchema)
		if (parsed.error) return parsed.error

		await hideComment(id, gate.user.id, parsed.data.reason)

		await logAudit({
			action: AuditAction.ADMIN_HIDE_COMMENT,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { reason: parsed.data.reason },
			targetId: id,
			targetType: "PostComment",
		})

		return ok({ hidden: true })
	},
)

export const dynamic = "force-dynamic"
