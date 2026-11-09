import { ok, parseBody } from "@/lib/api"
import { createGrantCardExportBatch, listGrantCardExports } from "@/lib/grant-cards"
import { type AuthedContext, withPermission, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantCardExportSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

/** The most recent import files, for the generated history. */
export const GET = withPermission(Permission.MANAGE_CREDIT, async () => ok(await listGrantCardExports(20)))

/**
 * Freeze a preview into an import file.
 *
 * The fingerprint is what makes a stale confirmation safe: if any project, amount or email changed since the
 * preview, this refuses rather than freezing a different set.
 */
export const POST = withWritePermission(Permission.MANAGE_CREDIT, async (req: Request, { gate }: AuthedContext) => {
	const parsed = await parseBody(req, grantCardExportSchema)
	if (parsed.error) return parsed.error

	const result = await createGrantCardExportBatch({
		admin: { email: gate.user.email, id: gate.user.id },
		fingerprint: parsed.data.fingerprint,
	})
	return ok(result)
})
