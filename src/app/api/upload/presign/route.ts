import { z } from "zod"
import { fail, ok, parseBody, rateLimitedInMemory } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { buildObjectKey, isUploadConfigured, presignUpload, UPLOAD_FOLDERS, validateUpload } from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"

/**
 * Mint a URL for a direct upload to the bucket.
 *
 * The old flow sent the file through this origin, which put Cloudflare's ~100 second origin timeout in the middle of every reel: the route could not answer until the whole body had arrived, so a 14 MiB clip on a school uplink came back as 524 while the server was still reading it. Here the origin answers immediately with a signature and the browser sends the bytes to R2 instead.
 *
 * Everything the app used to check before writing is still checked, just at a different moment: the claims here (extension, MIME, size cap, folder permission), and the real size, magic bytes and content hash at `/confirm`.
 */
export const POST = withSession(async (req, { gate }) => {
	if (rateLimitedInMemory(`upload-presign:${gate.user.id}`, 30, 60_000))
		return fail("RATE_LIMITED", "Too many uploads at once – wait a minute and try again")

	if (!isUploadConfigured()) return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const parsed = await parseBody(
		req,
		z.object({
			contentType: z.string().min(1).max(160),
			filename: z.string().min(1).max(255),
			folder: z.enum(UPLOAD_FOLDERS).default("sessions"),
			// Pictures are named after their bytes (see putObject's callers), so the client has to say which bytes it is about to send.
			sha256: z
				.string()
				.regex(/^[a-f0-9]{64}$/)
				.optional(),
			size: z.number().int().positive(),
		}),
	)
	if (parsed.error) return parsed.error
	const { contentType, filename, folder, sha256, size } = parsed.data

	// Shop pictures are the catalogue's, so only someone who runs the shop puts them there – and only pictures.
	if (folder === "shop") {
		if (!hasPermission(gate.roles, Permission.MANAGE_SHOP))
			return fail("FORBIDDEN", "Only shop managers can upload shop images")
		if (!contentType.startsWith("image/")) return fail("VALIDATION_FAILED", "Shop images must be pictures")
	}

	if (folder === "posts" && !contentType.startsWith("video/"))
		return fail("VALIDATION_FAILED", "Reel uploads must be video files")

	const check = validateUpload(filename, contentType, size)
	if (!check.ok) return fail("VALIDATION_FAILED", check.reason)

	const isImage = contentType.startsWith("image/")
	if (isImage && !sha256) return fail("VALIDATION_FAILED", "Image uploads must send a sha256 of their bytes")

	// Keys are namespaced by user so abuse is traceable and orphans are findable. Pictures are named after their bytes rather than a fresh uuid, so re-picking the same image mints the same URL; videos keep a random name because a reel is identified by its post. `.jpeg` is normalised to `.jpg` because the old server-side path sniffed the bytes and always named a JPEG `.jpg`; keeping both spellings would give one picture two keys and count it twice.
	const ext = check.ext === "jpeg" ? "jpg" : check.ext
	const key = buildObjectKey(gate.user.id, folder, ext, isImage ? sha256 : undefined)
	const presigned = await presignUpload(key, contentType)

	return ok(presigned, { status: 201 })
})
