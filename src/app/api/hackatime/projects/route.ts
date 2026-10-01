import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { listUserProjects } from "@/lib/hackatime"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const user = await prisma.user.findUnique({
		where: { id: gate.user.id },
		select: { hackatimeUserId: true },
	})
	if (!user?.hackatimeUserId) {
		return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account first")
	}

	return ok({ projects: await listUserProjects(user.hackatimeUserId) })
})
