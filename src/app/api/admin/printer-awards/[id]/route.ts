import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { updatePrinterAwardStatus } from "@/lib/printer"
import { printerAwardUpdateSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

/**
 * Move one printer award along its fulfilment path, or revoke it.
 *
 * FULFILL_ORDERS, not MANAGE_PROGRAM: shipping a printer is the same job as
 * shipping a shop order, and the role that does one does the other. The
 * transition rules and the audit row live in `updatePrinterAwardStatus`.
 */
export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.FULFILL_ORDERS)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, printerAwardUpdateSchema)
	if (parsed.error) return parsed.error

	const award = await updatePrinterAwardStatus(id, parsed.data, gate.user.id, gate.user.email)
	return ok({ award })
})
