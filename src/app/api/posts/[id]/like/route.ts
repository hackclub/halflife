import { ok, parseBody, withRoute } from "@/lib/api"
import { setLike } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { likeSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export const PUT = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, likeSchema)
	if (parsed.error) return parsed.error

	return ok(await setLike(id, gate.user.id, parsed.data.liked))
})
