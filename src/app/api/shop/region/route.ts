import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { shopRegionPreferenceSchema } from "@/lib/schemas/shop"

export const dynamic = "force-dynamic"

/**
 * Which region's prices a participant's shop shows. Null is base pricing; a
 * region id that is unknown or deactivated is refused, so a saved preference
 * can never point at prices that do not exist.
 */
export const PUT = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, shopRegionPreferenceSchema)
	if (parsed.error) return parsed.error
	const { regionId } = parsed.data

	if (regionId !== null) {
		const region = await prisma.shopRegion.findUnique({ where: { id: regionId }, select: { active: true } })
		if (!region) return fail("NOT_FOUND", "Region not found")
		if (!region.active) return fail("CONFLICT", "That region is not available right now")
	}

	await prisma.user.update({ where: { id: gate.user.id }, data: { shopRegionId: regionId } })

	return ok({ regionId })
})
