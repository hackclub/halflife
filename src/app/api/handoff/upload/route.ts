import { fail, ok, parseUploadForm, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { completeHandoff, resolveHandoff } from "@/lib/handoff"
import { isUploadConfigured, MAX_UPLOAD_BYTES } from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * The phone's upload. DELIBERATELY UNAUTHENTICATED.
 *
 * The whole feature is "record on your phone without signing in on it", so the
 * handoff token is the only credential. Everything that limits it lives in
 * lib/handoff.ts: single use, minutes-long expiry, and an object key built
 * from the handoff's OWNER rather than from anything in this request.
 */
export const POST = withRoute(async (req: Request) => {
	// Checked here as well as at mint time: a deployment can lose its bucket
	// between the QR being generated and the phone finishing a recording, and
	// the phone should be told that rather than handed a 500.
	if (!isUploadConfigured()) {
		return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")
	}

	// Capped before it is parsed, because this route has no session and the
	// token is inside the form: `req.formData()` would otherwise buffer whatever
	// the caller sends before any credential is checked.
	const parsed = await parseUploadForm(req, MAX_UPLOAD_BYTES)
	if (parsed.error) return parsed.error
	const form = parsed.data

	const token = form.get("token")
	if (typeof token !== "string" || !token) return fail("INVALID_BODY", "Missing token")

	const file = form.get("file")
	if (!(file instanceof File)) return fail("INVALID_BODY", "Expected a `file` field")

	// Resolved twice — once to attribute the audit row, once inside
	// completeHandoff where the claim actually happens. Only the second one is
	// authoritative.
	const target = await resolveHandoff(token)

	const result = await completeHandoff(token, {
		name: file.name,
		type: file.type,
		size: file.size,
		bytes: async () => Buffer.from(await file.arrayBuffer()),
	})

	if (target) {
		await logAudit({
			action: AuditAction.USER_HANDOFF_UPLOAD,
			actorId: target.userId,
			actorEmail: null,
			targetType: "UploadHandoff",
			targetId: target.id,
			metadata: { objectKey: result.objectKey, byteSize: file.size },
		})
	}

	return ok({ uploaded: true }, { status: 201 })
})
