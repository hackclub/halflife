import { ok, parseBody } from "@/lib/api"
import { createGrantCardBatch } from "@/lib/grant-cards"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantCardBatchSchema } from "@/lib/schemas/admin"

/**
 * Freeze a preview into a batch of pending card grants.
 *
 * The fingerprint is what makes a stale confirmation safe: if any project, amount or email changed since the preview, this refuses rather than issuing a different set.
 */
export const POST = withWritePermission(Permission.MANAGE_CREDIT, async (req: Request, { gate }: AuthedContext) => {
	const parsed = await parseBody(req, grantCardBatchSchema)
	if (parsed.error) return parsed.error

	const result = await createGrantCardBatch({
		admin: { email: gate.user.email, id: gate.user.id },
		fingerprint: parsed.data.fingerprint,
	})
	return ok(result)
})
