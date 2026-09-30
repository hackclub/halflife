import { ok, withRoute } from "@/lib/api"
import { recordView } from "@/lib/feed"
import { requireSession } from "@/lib/guards"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Deliberately not audit-logged: this fires once per viewer per reel and would
 * bury every other action in the log.
 */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requireSession()
  if (gate.error) return gate.error
  const { id } = await params

  return ok({ viewCount: await recordView(id, gate.user.id) })
})
