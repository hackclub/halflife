import { importWarmupProjects } from "@/lib/airtable/warmup-import"
import { ok, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/**
 * Reading the table is paginated, and each new row may copy a screenshot into
 * R2 and call Ari, so this is minutes rather than seconds.
 */
export const maxDuration = 300

/**
 * Import the warm-up form's projects off the `YSWS Project Submission` table.
 *
 * Idempotent: a rerun only picks up rows that arrived since the last one. Rows
 * Half Life itself wrote are skipped, and every import is recorded as an
 * ADMIN_IMPORT_AIRTABLE_PROJECT audit row keyed by its Airtable record id.
 */
export const POST = withRoute(async () => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error

	const summary = await importWarmupProjects({ id: gate.user.id, email: gate.user.email })
	return ok({ summary })
})
