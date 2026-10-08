import { z } from "zod"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { importMacondoProjects } from "@/lib/macondo-projects-csv"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/** A few thousand rows at a time, with every devlog parsed inline; multi-megabyte files round a touch slower than the default. */
const importSchema = z.object({ csv: z.string().min(1).max(10_000_000) }).strict()

/**
 * Import warm-up projects from a Macondo CSV export – one ThemeProject (Theme.WARMUP), with each entry in the row's `journals` column filed as a work session. Idempotent on the CSV's project_id.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error

	const parsed = await parseBody(req, importSchema)
	if (parsed.error) return parsed.error

	return ok(await importMacondoProjects({ id: gate.user.id, email: gate.user.email }, parsed.data.csv))
})
