import { fail, ok, parseBody } from "@/lib/api"
import { withWriteSession } from "@/lib/guards"
import db from "@/lib/prisma8"
import { shopRegionPreferenceSchema } from "@/lib/schemas/shop"

export const dynamic = "force-dynamic"

/**
 * Which region's prices a participant's shop shows. Null is base pricing; a region id that is unknown or deactivated is refused, so a saved preference can never point at prices that do not exist.
 */
export const PUT = withWriteSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, shopRegionPreferenceSchema)
	if (parsed.error) return parsed.error
	const { regionId } = parsed.data

	if (regionId !== null) {
		const region = await db.orm.public.ShopRegion.whereUnique({ id: regionId }).select("active").first()
		if (!region) return fail("NOT_FOUND", "Region not found")
		if (!region.active) return fail("CONFLICT", "That region is not available right now")
	}

	await db.orm.public.User.where({ id: gate.user.id }).update({ shopRegionId: regionId })

	return ok({ regionId })
})
