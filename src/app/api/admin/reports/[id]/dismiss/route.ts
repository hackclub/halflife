import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { decideReport } from "@/lib/report-decisions"

interface Params {
	params: Promise<{ id: string }>
}

/** Close a report as no violation. */
export const POST = withPermission(
	Permission.MANAGE_FEED,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		return decideReport(gate, id, "DISMISSED")
	},
)

export const dynamic = "force-dynamic"
