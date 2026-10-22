import { fail, ok, parseUploadForm, rateLimitedInMemory, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { clientIp } from "@/lib/client-ip"
import { completeHandoff, resolveHandoff } from "@/lib/handoff"
import { isUploadConfigured } from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * This route's own budget, rather than the shared one.
 *
 * Every other upload is behind a session, so the size of a body is a decision the signed-in user made about their own storage. This one is not: the token inside the form is the only credential and it is not read until the body has been buffered, so the body size is the attacker's choice. A phone video is tens of megabytes, so 64 MiB is generous for the thing this route is for, and it is a quarter of what the authenticated upload route allows.
 */
const HANDOFF_MAX_UPLOAD_BYTES = 64 * 1024 * 1024

/**
 * How many uploads one address may start in a minute.
 *
 * The shared limiter allows ten; this is the same idea with less room, because the requests it counts are the ones that cost the most memory to refuse.
 */
const HANDOFF_MAX_PER_MINUTE = 5

/**
 * The phone's upload. DELIBERATELY UNAUTHENTICATED.
 *
 * The whole feature is "record on your phone without signing in on it", so the handoff token is the only credential. Everything that limits it lives in lib/handoff.ts: single use, minutes-long expiry, and an object key built from the handoff's OWNER rather than from anything in this request.
 */
export const POST = withRoute(async (req: Request) => {
	// Checked here as well as at mint time: a deployment can lose its bucket between the QR being generated and the phone finishing a recording, and the phone should be told that rather than handed a 500.
	if (!isUploadConfigured()) return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	// The token is the only credential and it lives inside the form, so without this a caller could loop the largest allowed body until the process runs out of memory before any token is ever read.
	if (rateLimitedInMemory(`handoff-upload:${clientIp(req.headers)}`, HANDOFF_MAX_PER_MINUTE))
		return fail("RATE_LIMITED", "Too many uploads at once – wait a minute and try again")

	// Capped before it is parsed, because this route has no session and the token is inside the form: `req.formData()` would otherwise buffer whatever the caller sends before any credential is checked.
	const parsed = await parseUploadForm(req, HANDOFF_MAX_UPLOAD_BYTES)
	if (parsed.error) return parsed.error
	const form = parsed.data

	const token = form.get("token")
	if (typeof token !== "string" || !token) return fail("INVALID_BODY", "Missing token")

	const file = form.get("file")
	if (!(file instanceof File)) return fail("INVALID_BODY", "Expected a `file` field")

	// Resolved twice – once to attribute the audit row, once inside completeHandoff where the claim actually happens. Only the second one is authoritative.
	const target = await resolveHandoff(token)

	const result = await completeHandoff(token, {
		bytes: async () => Buffer.from(await file.arrayBuffer()),
		name: file.name,
		size: file.size,
		type: file.type,
	})

	if (target)
		await logAudit({
			action: AuditAction.USER_HANDOFF_UPLOAD,
			actorEmail: null,
			actorId: target.userId,
			metadata: { byteSize: file.size, objectKey: result.objectKey },
			targetId: target.id,
			targetType: "UploadHandoff",
		})

	return ok({ uploaded: true }, { status: 201 })
})
