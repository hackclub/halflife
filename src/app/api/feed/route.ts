import { ok, withRoute } from "@/lib/api"
import { getFeed } from "@/lib/feed"
import { requireSession } from "@/lib/guards"
import { paginationQuery } from "@/lib/pagination"

export const dynamic = "force-dynamic"

export const GET = withRoute(async (req: Request) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const url = new URL(req.url)
  const parsed = paginationQuery.safeParse({
    cursor: url.searchParams.get("cursor") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
  })
  const { cursor, limit } = parsed.success ? parsed.data : { cursor: undefined, limit: 25 }

  return ok(await getFeed(gate.user.id, { cursor, limit }))
})
