import { fail, ok } from "@/lib/api"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Take back a public link you added – the wrong post pasted, or a post since deleted. Only your own. Removing it also frees that link to be added again.
 */
export const DELETE = withWriteSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const count = await db.orm.public.PublicReel.where({ id, userId: gate.user.id }).deleteAndCount()
	if (count === 0) return fail("NOT_FOUND", "Link not found")
	return ok({ deleted: true })
})
