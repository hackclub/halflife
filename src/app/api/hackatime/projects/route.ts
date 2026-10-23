/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { fail, ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { listUserProjects } from "@/lib/hackatime"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { gate }) => {
	const user = await prisma.user.findUnique({
		select: { hackatimeUserId: true },
		where: { id: gate.user.id },
	})
	if (!user?.hackatimeUserId) return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account first")

	return ok({ projects: await listUserProjects(user.hackatimeUserId) })
})
