import { ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { changeDeliveryPreferenceSchema } from "@/lib/schemas/shop"
import { changeDeliveryPreference } from "@/lib/shop"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * A participant changing how their own open order is delivered.
 *
 * Ownership, the open-order window and the grant card amount all live in `changeDeliveryPreference`, under the same per-user credit lock the purchase and cancel take.
 */
export const POST = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, changeDeliveryPreferenceSchema)
	if (parsed.error) return parsed.error

	const order = await changeDeliveryPreference(id, gate.user.id, parsed.data.deliveryPreference)
	return ok({ order })
})
