import { ok } from "@/lib/api"
import { recordView } from "@/lib/feed"
import { type AuthedContext, withWriteSession } from "@/lib/guards"

export const dynamic = "force-dynamic"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * Deliberately not audit-logged: this fires once per viewer per reel and would bury every other action in the log.
 */
export const POST = withWriteSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	return ok({ viewCount: await recordView(id, gate.user.id) })
})
