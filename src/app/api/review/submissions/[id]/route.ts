import { fail, ok, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { getSubmissionDetail } from "@/lib/queries/review"

type Params = { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

export const GET = withRoute(async (_req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.REVIEW_SUBMISSIONS)
  if (gate.error) return gate.error
  const { id } = await params

  const detail = await getSubmissionDetail(id, gate.user.id)
  if (!detail) return fail("NOT_FOUND", "Submission not found")
  return ok(detail)
})
