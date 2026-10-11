import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { createPost } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { getUserRoles, hasPermission, Permission } from "@/lib/permissions"
import { assertNoOwedReel } from "@/lib/reel-gate"
import { createPostSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	// A refusal is recorded before it is thrown. `withRoute` turns an HttpError into a response and keeps it to itself, so before this a maker blocked by an owed reel, or by an upload-ownership check, left no row anywhere: the client was told why and the server forgot. This is the only place the number of people stuck this way can be seen.
	try {
		const parsed = await parseBody(req, createPostSchema)
		if (parsed.error) throw parsed.error

		// A checkpoint reel is checkpoint work, so a deleted reel that is still owed holds it – unless this is that reel coming back. Freeform posts are not a checkpoint and are never held.
		if (parsed.data.checkpointKey) await assertNoOwedReel(gate.user.id, parsed.data.checkpointKey)

		const roles = await getUserRoles(gate.user.id)

		const post = await createPost({
			userId: gate.user.id,
			kind: parsed.data.kind,
			caption: parsed.data.caption,
			objectKey: parsed.data.objectKey,
			thumbnailKey: parsed.data.thumbnailKey ?? null,
			themeProjectId: parsed.data.themeProjectId ?? null,
			checkpointKey: parsed.data.checkpointKey ?? null,
			contentType: parsed.data.contentType ?? null,
			byteSize: parsed.data.byteSize ?? null,
			durationSeconds: parsed.data.durationSeconds ?? null,
			width: parsed.data.width ?? null,
			height: parsed.data.height ?? null,
			canManageFeed: hasPermission(roles, Permission.MANAGE_FEED),
		})

		await logAudit({
			action: AuditAction.USER_CREATE_POST,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "Post",
			targetId: post.id,
			metadata: { kind: post.kind, themeProjectId: post.project?.id ?? null },
		})

		return ok({ post }, { status: 201 })
	} catch (err) {
		await logPostRefusal(gate.user.id, gate.user.email, req, err)
		throw err
	}
})

/**
 * Record a refused post.
 *
 * Deliberately not carrying the caption: the reason is the diagnostic, and a maker's own words are not needed to find it. The body is re-read only for the checkpoint the post was answering.
 */
async function logPostRefusal(userId: string, actorEmail: string, req: Request, err: unknown): Promise<void> {
	const code = err instanceof HttpError ? err.code : "INTERNAL"
	let checkpointKey: string | null = null
	try {
		const body = (await req.clone().json()) as { checkpointKey?: unknown }
		if (typeof body?.checkpointKey === "string") checkpointKey = body.checkpointKey
	} catch {
		// The body was unparseable, which is itself what the recorded reason will say.
	}
	await logAudit({
		action: AuditAction.USER_CREATE_POST_FAILED,
		actorId: userId,
		actorEmail,
		targetType: "User",
		targetId: userId,
		metadata: {
			code,
			reason: err instanceof Error ? err.message : String(err),
			...(checkpointKey ? { checkpointKey } : {}),
		},
	})
}
