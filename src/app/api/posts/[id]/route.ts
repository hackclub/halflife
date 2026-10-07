import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { deleteOwnPost } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { reelLockReason } from "@/lib/reel-gate"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Delete one of your own posts.
 *
 * A reel on a checkpoint can only go while its week can still take work: a week in review or decided keeps its reels as its record, and a passed week could never have the reel re-recorded, which would hold the rest of the map forever (see lib/reel-gate).
 */
export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const post = await prisma.post.findFirst({
		where: { id, userId: gate.user.id, deletedAt: null },
		select: { checkpointKey: true, themeProjectId: true },
	})
	if (!post) return fail("NOT_FOUND", "Post not found")
	if (post.checkpointKey) {
		const locked = await reelLockReason(gate.user.id, post.themeProjectId, post.checkpointKey)
		if (locked) return fail("PHASE_LOCKED", locked)
	}

	await deleteOwnPost(id, gate.user.id)

	await logAudit({
		action: AuditAction.USER_DELETE_POST,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "Post",
		targetId: id,
		metadata: { checkpointKey: post.checkpointKey },
	})

	return ok({ deleted: true })
})
