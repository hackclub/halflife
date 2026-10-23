/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { ok } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { deleteOwnComment } from "@/lib/feed"
import { type AuthedContext, withSession } from "@/lib/guards"

interface Params {
	params: Promise<{ id: string }>
}

export const DELETE = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
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

export const dynamic = "force-dynamic"
