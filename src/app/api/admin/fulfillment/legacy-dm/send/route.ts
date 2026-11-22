import { ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { sendLegacyShopDms } from "@/lib/legacy-shop-dm"
import { Permission } from "@/lib/permissions"
import { legacyShopDmSendSchema } from "@/lib/schemas/admin"

/**
 * Send one Slack DM to each picked buyer about their orders placed before the delivery choice existed.
 *
 * Each buyer is claimed in the database before Slack is called, so a buyer already messaged is reported as skipped rather than messaged again. A failure for one buyer does not stop the rest; its reason comes back in `outcomes`.
 */
export const POST = withWritePermission(Permission.FULFILL_ORDERS, async (req: Request, { gate }: AuthedContext) => {
	const parsed = await parseBody(req, legacyShopDmSendSchema)
	if (parsed.error) return parsed.error
	return ok({ outcomes: await sendLegacyShopDms(parsed.data.userIds, gate.user.id) })
})
