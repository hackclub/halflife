import { ok, parseBody } from "@/lib/api"
import { setLike } from "@/lib/feed"
import { type AuthedContext, withWriteSession } from "@/lib/guards"
import { likeSchema } from "@/lib/schemas/feed"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

export const PUT = withWriteSession(async (req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const parsed = await parseBody(req, likeSchema)
	if (parsed.error) return parsed.error

	return ok(await setLike(id, gate.user.id, parsed.data.liked))
})
