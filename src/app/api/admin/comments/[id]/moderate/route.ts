import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { hideComment, restoreComment } from "@/lib/feed"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { moderatePostSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Hide a comment, or put a hidden one back. Hiding takes it out of the feed and out of the post's comment count; restoring does both in reverse, in one transaction, so the count and the rows cannot disagree.
 */
export const POST = withWritePermission(
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

/** Put it back. */
export const DELETE = withWritePermission(
	Permission.MANAGE_FEED,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		await restoreComment(id)

		await logAudit({
			action: AuditAction.ADMIN_RESTORE_COMMENT,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			targetId: id,
			targetType: "PostComment",
		})

		return ok({ restored: true })
	},
)
