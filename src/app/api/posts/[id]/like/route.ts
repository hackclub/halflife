import { ok, parseBody } from "@/lib/api"
import { setLike } from "@/lib/feed"
import { type AuthedContext, withSession } from "@/lib/guards"
import { likeSchema } from "@/lib/schemas/feed"

interface Params {
	params: Promise<{ id: string }>
}

export const PUT = withSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, likeSchema)
	if (parsed.error) return parsed.error

	return ok(await setLike(id, gate.user.id, parsed.data.liked))
})

export const dynamic = "force-dynamic"
