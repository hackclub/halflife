import { ok } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { deleteOwnComment } from "@/lib/feed"
import { type AuthedContext, withWriteSession } from "@/lib/guards"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

export const DELETE = withWriteSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	await deleteOwnComment(id, gate.user.id)

	await logAudit({
		action: AuditAction.USER_DELETE_COMMENT,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		targetId: id,
		targetType: "PostComment",
	})

	return ok({ deleted: true })
})
