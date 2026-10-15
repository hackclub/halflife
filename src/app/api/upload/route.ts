import { fail, ok, parseUploadForm, rateLimitedInMemory, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { getUserRoles, hasPermission, Permission } from "@/lib/permissions"
import {
	buildObjectKey,
	contentHash,
	isUploadConfigured,
	isVideoBytes,
	MAX_UPLOAD_BYTES,
	publicUrlFor,
	putObject,
	validateUpload,
} from "@/lib/uploads/r2"
import { sniffImage } from "@/lib/uploads/remote"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const ALLOWED_FOLDERS = new Set(["sessions", "covers", "timelapses", "posts", "shop"])

export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	if (rateLimitedInMemory(`upload:${gate.user.id}`))
		return fail("RATE_LIMITED", "Too many uploads at once – wait a minute and try again")

	if (!isUploadConfigured()) return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	const parsed = await parseUploadForm(req, MAX_UPLOAD_BYTES)
	if (parsed.error) return parsed.error
	const file = parsed.data.get("file")
	if (!(file instanceof File)) return fail("INVALID_BODY", "Expected a `file` field")

	const folderRaw = parsed.data.get("folder")
	const folder = typeof folderRaw === "string" && ALLOWED_FOLDERS.has(folderRaw) ? folderRaw : "sessions"

	// Shop pictures are the catalogue's, so only someone who runs the shop puts them there – and only pictures.
	if (folder === "shop") {
		if (!hasPermission(await getUserRoles(gate.user.id), Permission.MANAGE_SHOP))
			return fail("FORBIDDEN", "Only shop managers can upload shop images")
		if (!file.type.startsWith("image/")) return fail("VALIDATION_FAILED", "Shop images must be pictures")
	}

	if (file.size > MAX_UPLOAD_BYTES) return fail("VALIDATION_FAILED", `Files must be under ${MAX_UPLOAD_BYTES} bytes`)

	if (folder === "posts" && !file.type.startsWith("video/"))
		return fail("VALIDATION_FAILED", "Reel uploads must be video files")

	const check = validateUpload(file.name, file.type, file.size)
	if (!check.ok) return fail("VALIDATION_FAILED", check.reason)

	const bytes = Buffer.from(await file.arrayBuffer())
	if (file.type.startsWith("video/") && !isVideoBytes(bytes))
		return fail("VALIDATION_FAILED", "That file does not look like a video")

	// The extension/MIME check above trusts what the client *claimed*. For images, verify the bytes too – the from-url path already does – so an HTML file renamed to .png cannot land in the bucket as image/png.
	let ext = check.ext
	let contentType = file.type
	if (file.type.startsWith("image/")) {
		const sniffed = sniffImage(bytes)
		if (!sniffed) return fail("VALIDATION_FAILED", "That file does not look like a PNG, JPEG, GIF or WebP image")
		ext = sniffed.ext
		contentType = sniffed.contentType
	}

	// Keys are namespaced by user so abuse is traceable and orphans are findable. Pictures are named after their bytes rather than a fresh uuid: picking the same image again has to mint the same URL, because the journal counts its evidence by URL (`countImages`) and a second URL counts as a second picture. Videos keep the random name – a reel is identified by its post.
	const name = contentType.startsWith("image/") ? contentHash(bytes) : undefined
	const key = buildObjectKey(gate.user.id, folder, ext, name)
	await putObject(key, bytes, contentType)

	return ok({ objectKey: key, url: publicUrlFor(key) }, { status: 201 })
})
