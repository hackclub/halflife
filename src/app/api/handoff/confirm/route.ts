import { z } from "zod"
import { fail, ok, parseBody, rateLimitedInMemory, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { clientIp } from "@/lib/client-ip"
import { completeHandoffObject, HANDOFF_MAX_PER_MINUTE, resolveHandoff } from "@/lib/handoff"
import { isUploadConfigured } from "@/lib/uploads/r2"

export const dynamic = "force-dynamic"

/**
 * The phone's half of a direct handoff upload: spend the token on what landed.
 *
 * The bytes are already in the bucket when this runs, so the claims that came with them are checked against the bucket's copy – real size, video signature, the owner's prefix – and then the token is claimed and the key recorded. A token that loses the race deletes its own upload.
 */
export const POST = withRoute(async (req: Request) => {
	if (!isUploadConfigured()) return fail("NOT_CONFIGURED", "File uploads are not configured on this deployment")

	if (rateLimitedInMemory(`handoff-confirm:${clientIp(req.headers)}`, HANDOFF_MAX_PER_MINUTE))
		return fail("RATE_LIMITED", "Too many uploads at once. Wait a minute and try again")

	const parsed = await parseBody(
		req,
		z.object({
			contentType: z.string().min(1).max(160),
			filename: z.string().min(1).max(255),
			objectKey: z.string().min(1).max(1024),
			size: z.number().int().positive(),
			token: z.string().min(1).max(200),
		}),
	)
	if (parsed.error) return parsed.error
	const { objectKey, token, ...file } = parsed.data

	// Resolved twice – once to attribute the audit row, once inside completeHandoffObject where the claim happens. Only the second one is authoritative.
	const target = await resolveHandoff(token)
	const result = await completeHandoffObject(token, { objectKey, ...file })

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
