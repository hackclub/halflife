import { fail, ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { listUserProjects } from "@/lib/hackatime"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { gate }) => {
	const user = await db.orm.public.User.whereUnique({ id: gate.user.id }).select("hackatimeUserId").first()
	if (!user?.hackatimeUserId) return fail("HACKATIME_NOT_LINKED", "Link your Hackatime account first")

	return ok({ projects: await listUserProjects(user.hackatimeUserId) })
})
