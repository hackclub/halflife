import { z } from "zod"
import { fail, ok, parseBody, rateLimitedInMemory } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { isOwnedKey, isUploadConfigured, publicUrlFor, UPLOAD_FOLDERS, validateUpload } from "@/lib/uploads/r2"
import { verifyStoredUpload } from "@/lib/uploads/verify"

export const dynamic = "force-dynamic"

const ALLOWED_FOLDERS = new Set<string>(UPLOAD_FOLDERS)

/**
 * Check a file that the browser sent straight to the bucket, before anything can point at it.
 *
 * A presigned URL cannot prove what was sent, only who may send it, so this is where the old route's byte checks live now: the size the bucket reports (not the one the client claims), the container or image signature, and for pictures the hash the key is named after. An object that fails is deleted.
 *
 * The key is taken from the request but is re-checked against the session: only a key in the caller's own prefix, in a known folder, and in the shape this app mints can be confirmed. Without that, a participant could confirm somebody else's object and attach it to their own post.
 */
export const POST = withSession(async (req, { gate }) => {
	if (rateLimitedInMemory(`upload-confirm:${gate.user.id}`, 30, 60_000))
		return fail("RATE_LIMITED", "Too many uploads at once. Wait a minute and try again")

	if (!isUploadConfigured()) return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const parsed = await parseBody(
		req,
		z.object({
			contentType: z.string().min(1).max(160),
			objectKey: z.string().min(1).max(1024),
			size: z.number().int().positive(),
		}),
	)
	if (parsed.error) return parsed.error
	const { contentType, objectKey, size } = parsed.data

	if (!isOwnedKey(gate.user.id, objectKey)) return fail("FORBIDDEN", "That object is not yours")

	// `folder/userId/name.ext`, exactly: a nested path is not a key this app minted, whatever its first segment says.
	const segments = objectKey.split("/")
	const folder = segments[0] ?? ""
	if (segments.length !== 3 || !ALLOWED_FOLDERS.has(folder))
		return fail("VALIDATION_FAILED", "That is not an upload this app made")

	if (folder === "shop" && !hasPermission(gate.roles, Permission.MANAGE_SHOP))
		return fail("FORBIDDEN", "Only shop managers can upload shop images")
	if (folder === "posts" && !contentType.startsWith("video/"))
		return fail("VALIDATION_FAILED", "Reel uploads must be video files")

	const check = validateUpload(objectKey, contentType, size)
	if (!check.ok) return fail("VALIDATION_FAILED", check.reason)

	await verifyStoredUpload(objectKey, contentType.startsWith("video/") ? "video" : "image", contentType)

	return ok({ objectKey, url: publicUrlFor(objectKey) }, { status: 201 })
})
