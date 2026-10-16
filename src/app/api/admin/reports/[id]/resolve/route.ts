import { withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { decideReport } from "@/lib/report-decisions"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/** Close a report as reviewed. Taking the thing down stays a separate action. */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_FEED)
	if (gate.error) return gate.error
	const { id } = await params

	return decideReport(gate, id, "RESOLVED")
})
