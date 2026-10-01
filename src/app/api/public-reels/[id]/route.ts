import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Take back a public link you added — the wrong post pasted, or a post since
 * deleted. Only your own. Removing it also frees that link to be added again.
 */
export const DELETE = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const { count } = await prisma.publicReel.deleteMany({ where: { id, userId: gate.user.id } })
	if (count === 0) return fail("NOT_FOUND", "Link not found")
	return ok({ deleted: true })
})
