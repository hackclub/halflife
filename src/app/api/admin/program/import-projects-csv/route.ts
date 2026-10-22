import { z } from "zod"
import { ok, parseBody } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { importMacondoProjects } from "@/lib/macondo-projects-csv"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/** A few thousand rows at a time, with every devlog parsed inline; multi-megabyte files round a touch slower than the default. */
const importSchema = z.object({ csv: z.string().min(1).max(10_000_000) }).strict()

/**
 * Import warm-up projects from a Macondo CSV export – one ThemeProject (Theme.WARMUP), with each entry in the row's `journals` column filed as a work session. Idempotent on the CSV's project_id.
 */
export const POST = withPermission(Permission.MANAGE_PROGRAM, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, importSchema)
	if (parsed.error) return parsed.error

	return ok(await importMacondoProjects({ email: gate.user.email, id: gate.user.id }, parsed.data.csv))
})
