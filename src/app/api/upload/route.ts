import { fail, ok, parseUploadForm, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import {
  buildObjectKey,
  isUploadConfigured,
  isVideoBytes,
  MAX_UPLOAD_BYTES,
  publicUrlFor,
  putObject,
  validateUpload,
} from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const ALLOWED_FOLDERS = new Set(["sessions", "covers", "timelapses", "posts"])

export const POST = withRoute(async (req: Request) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  if (!isUploadConfigured()) {
    return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")
  }

  const parsed = await parseUploadForm(req, MAX_UPLOAD_BYTES)
  if (parsed.error) return parsed.error
  const file = parsed.data.get("file")
  if (!(file instanceof File)) return fail("INVALID_BODY", "Expected a `file` field")

  const folderRaw = parsed.data.get("folder")
  const folder = typeof folderRaw === "string" && ALLOWED_FOLDERS.has(folderRaw) ? folderRaw : "sessions"

  if (file.size > MAX_UPLOAD_BYTES) {
    return fail("VALIDATION_FAILED", `Files must be under ${MAX_UPLOAD_BYTES} bytes`)
  }

  if (folder === "posts" && !file.type.startsWith("video/")) {
    return fail("VALIDATION_FAILED", "Reel uploads must be video files")
  }

  const check = validateUpload(file.name, file.type, file.size)
  if (!check.ok) return fail("VALIDATION_FAILED", check.reason)

  const bytes = Buffer.from(await file.arrayBuffer())
  if (folder === "posts" && !isVideoBytes(bytes)) {
    return fail("VALIDATION_FAILED", "That file does not look like a video")
  }

  // Keys are namespaced by user so abuse is traceable and orphans are findable.
  const key = buildObjectKey(gate.user.id, folder, check.ext)
  await putObject(key, bytes, file.type)

  return ok({ objectKey: key, url: publicUrlFor(key) }, { status: 201 })
})
