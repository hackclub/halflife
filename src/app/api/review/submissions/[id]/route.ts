import { fail, ok } from "@/lib/api"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import { getSubmissionDetail } from "@/lib/queries/review"

interface Params {
	params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

export const GET = withPermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const detail = await getSubmissionDetail(id, gate.user.id, {
			includeContact: hasRole(gate.roles, Role.ADMIN) || hasRole(gate.roles, Role.AUDITOR),
			includeRiskFlags:
				hasRole(gate.roles, Role.ADMIN)
				|| hasRole(gate.roles, Role.AUDITOR)
				|| hasPermission(gate.roles, Permission.REVIEW_HOURS),
		})
		if (!detail) return fail("NOT_FOUND", "Submission not found")
		return ok(detail)
	},
)
