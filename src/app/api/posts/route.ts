import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { createPost } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { getUserRoles, hasPermission, Permission } from "@/lib/permissions"
import { assertNoOwedReel } from "@/lib/reel-gate"
import { createPostSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, createPostSchema)
	if (parsed.error) return parsed.error

	// A checkpoint reel is checkpoint work, so a deleted reel that is still owed
	// holds it – unless this is that reel coming back. Freeform posts are not a
	// checkpoint and are never held.
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
})
