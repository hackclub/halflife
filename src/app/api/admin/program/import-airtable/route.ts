import { importWarmupProjects } from "@/lib/airtable/warmup-import"
import { ok } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/**
 * Reading the table is paginated, and each new row may copy a screenshot into R2 and call Ari, so this is minutes rather than seconds.
 */
export const maxDuration = 300

/**
 * Import the warm-up form's projects off the `YSWS Project Submission` table.
 *
 * Idempotent: a rerun only picks up rows that arrived since the last one. Rows Half Life itself wrote are skipped, and every import is recorded as an ADMIN_IMPORT_AIRTABLE_PROJECT audit row keyed by its Airtable record id.
 */
export const POST = withPermission(Permission.MANAGE_PROGRAM, async (_req: Request, { gate }) => {
	const summary = await importWarmupProjects({ email: gate.user.email, id: gate.user.id })
	return ok({ summary })
})
