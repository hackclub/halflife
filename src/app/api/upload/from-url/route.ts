import { z } from "zod"
import { fail, ok, parseBody, rateLimitedInMemory, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import {
	buildObjectKey,
	contentHash,
	isUploadConfigured,
	MAX_UPLOAD_BYTES,
	publicUrlFor,
	putObject,
} from "@/lib/uploads/r2"
import { fetchRemoteImage } from "@/lib/uploads/remote"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const bodySchema = z.object({ url: z.string().url().max(2048) }).strict()

/**
 * Re-host an image from another site in the bucket: an image dragged into a journal entry from another page arrives as its address, and a hotlinked picture can vanish or change after the entry is reviewed. Journal images only, so they land beside the uploaded ones in `sessions`, named after their bytes the same way (see /api/upload).
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	// The same budget as a file upload: fetching for someone is uploading for them.
	if (rateLimitedInMemory(`upload:${gate.user.id}`)) {
		return fail("RATE_LIMITED", "Too many uploads at once – wait a minute and try again")
	}
	if (!isUploadConfigured()) {
		return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")
	}

	const parsed = await parseBody(req, bodySchema)
	if (parsed.error) return parsed.error

	const image = await fetchRemoteImage(parsed.data.url, MAX_UPLOAD_BYTES)
	const key = buildObjectKey(gate.user.id, "sessions", image.ext, contentHash(image.bytes))
	await putObject(key, image.bytes, image.contentType)

	return ok({ objectKey: key, url: publicUrlFor(key) }, { status: 201 })
})
