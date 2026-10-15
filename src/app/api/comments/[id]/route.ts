import { ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { deleteOwnComment } from "@/lib/feed"
import { requireSession } from "@/lib/guards"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
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
