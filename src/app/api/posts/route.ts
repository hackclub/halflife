import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { createPost } from "@/lib/feed"
import { withSession } from "@/lib/guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { assertNoOwedReel } from "@/lib/reel-gate"
import { createPostSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

export const POST = withSession(async (req: Request, { gate }) => {
	// A refusal is recorded before it is returned. `withRoute` turns an HttpError into a response and keeps it to itself, so before this a maker blocked by an owed reel, or by an upload-ownership check, left no row anywhere: the client was told why and the server forgot. This is the only place the number of people stuck this way can be seen.
	const parsed = await parseBody(req, createPostSchema)
	if (parsed.error) {
		await logPostRefusal(gate.user.id, gate.user.email, req, parsed.error)
		return parsed.error
	}

	try {
		// A checkpoint reel is checkpoint work, so a deleted reel that is still owed holds it – unless this is that reel coming back. Freeform posts are not a checkpoint and are never held.
		if (parsed.data.checkpointKey) await assertNoOwedReel(gate.user.id, parsed.data.checkpointKey)

		const post = await createPost({
			byteSize: parsed.data.byteSize ?? null,
			canManageFeed: hasPermission(gate.roles, Permission.MANAGE_FEED),
			caption: parsed.data.caption,
			checkpointKey: parsed.data.checkpointKey ?? null,
			contentType: parsed.data.contentType ?? null,
			durationSeconds: parsed.data.durationSeconds ?? null,
			height: parsed.data.height ?? null,
			kind: parsed.data.kind,
			objectKey: parsed.data.objectKey,
			themeProjectId: parsed.data.themeProjectId ?? null,
			thumbnailKey: parsed.data.thumbnailKey ?? null,
			userId: gate.user.id,
			width: parsed.data.width ?? null,
		})

		await logAudit({
			action: AuditAction.USER_CREATE_POST,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { kind: post.kind, themeProjectId: post.project?.id ?? null },
			targetId: post.id,
			targetType: "Post",
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
		// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untyped source at this boundary
		const body = (await req.clone().json()) as { checkpointKey?: unknown }
		if (typeof body?.checkpointKey === "string") ({ checkpointKey } = body)
	} catch {
		// The body was unparseable, which is itself what the recorded reason will say.
	}
	await logAudit({
		action: AuditAction.USER_CREATE_POST_FAILED,
		actorEmail,
		actorId: userId,
		metadata: {
			code,
			reason: err instanceof Error ? err.message : String(err),
			...(checkpointKey ? { checkpointKey } : {}),
		},
		targetId: userId,
		targetType: "User",
	})
}
