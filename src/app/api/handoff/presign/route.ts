import { z } from "zod"
import { fail, ok, parseBody, rateLimitedInMemory, withRoute } from "@/lib/api"
import { clientIp } from "@/lib/client-ip"
import { HANDOFF_MAX_PER_MINUTE, prepareHandoffUpload } from "@/lib/handoff"
import { isUploadConfigured } from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"

/**
 * The phone's half of a direct handoff upload: mint the URL it PUTs to.
 *
 * Unauthenticated on purpose, like the rest of this feature: the token in the body is the credential, and the bytes never touch this origin. The URL that comes back writes under the token owner's prefix and nowhere else.
 *
 * A bad claim is refused here rather than after the phone has spent its data on a video the app was always going to reject.
 */
export const POST = withRoute(async (req: Request) => {
	if (!isUploadConfigured()) return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	if (rateLimitedInMemory(`handoff-presign:${clientIp(req.headers)}`, HANDOFF_MAX_PER_MINUTE))
		return fail("RATE_LIMITED", "Too many uploads at once. Wait a minute and try again")

	const parsed = await parseBody(
		req,
		z.object({
			contentType: z.string().min(1).max(160),
			filename: z.string().min(1).max(255),
			size: z.number().int().positive(),
			token: z.string().min(1).max(200),
		}),
	)
	if (parsed.error) return parsed.error
	const { token, ...file } = parsed.data

	return ok(await prepareHandoffUpload(token, file), { status: 201 })
})
