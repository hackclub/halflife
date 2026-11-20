import { ok, parseBody } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { sendLegacyShopTest } from "@/lib/legacy-shop-dm"
import { Permission } from "@/lib/permissions"
import { legacyShopDmTestSchema } from "@/lib/schemas/admin"

/** Send the legacy-order DM to one Slack ID as a test. It lists no order and changes none, but it is recorded in the same history. */
export const POST = withWritePermission(Permission.FULFILL_ORDERS, async (req: Request, { gate }: AuthedContext) => {
	const parsed = await parseBody(req, legacyShopDmTestSchema)
	if (parsed.error) return parsed.error
	return ok({ result: await sendLegacyShopTest(parsed.data.slackId, gate.user.id) })
})
