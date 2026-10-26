import { fail, ok } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { deleteOwnPost } from "@/lib/feed"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import db from "@/lib/prisma8"
import { reelLockReason } from "@/lib/reel-gate"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Delete one of your own posts.
 *
 * A reel on a checkpoint can only go while its week can still take work: a week in review or decided keeps its reels as its record, and a passed week could never have the reel re-recorded, which would hold the rest of the map forever (see lib/reel-gate).
 */
export const DELETE = withWriteSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const post = await db.orm.public.Post.where({ deletedAt: null, id, userId: gate.user.id })
		.select("checkpointKey", "themeProjectId")
		.first()
	if (!post) return fail("NOT_FOUND", "Post not found")
	if (post.checkpointKey) {
		const locked = await reelLockReason(gate.user.id, post.themeProjectId, post.checkpointKey)
		if (locked) return fail("PHASE_LOCKED", locked)
	}

	await deleteOwnPost(id, gate.user.id)

	await logAudit({
		action: AuditAction.USER_DELETE_POST,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { checkpointKey: post.checkpointKey },
		targetId: id,
		targetType: "Post",
	})

	return ok({ deleted: true })
})
