import { ok } from "@/lib/api"
import { getGrantCardBatch } from "@/lib/grant-cards"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

export const GET = withPermission(Permission.MANAGE_CREDIT, async (_req: Request, { params }: Params) => {
	const { id } = await params
	const batch = await getGrantCardBatch(id)
	return batch ? ok(batch) : ok(null)
})
