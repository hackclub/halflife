import { fail, ok } from "@/lib/api"
import { type AuthedContext, withSession } from "@/lib/guards"
import prisma from "@/lib/prisma"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Take back a public link you added – the wrong post pasted, or a post since deleted. Only your own. Removing it also frees that link to be added again.
 */
export const DELETE = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const { count } = await prisma.publicReel.deleteMany({ where: { id, userId: gate.user.id } })
	if (count === 0) return fail("NOT_FOUND", "Link not found")
	return ok({ deleted: true })
})

export const dynamic = "force-dynamic"
