import { ok, parseBody, withRoute } from "@/lib/api"
import { sendGrant } from "@/lib/grants"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 60

/**
 * Send a project's design grant to the maker's HCB card grant.
 *
 * A payout is a MANAGE_CREDIT action, not a review one: a reviewer decides what a project is worth, and granting the money is deliberately a different permission. Idempotent per (user, project, design) in lib/grants.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_CREDIT)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, grantSchema)
	if (parsed.error) return parsed.error

	const result = await sendGrant({
		adminEmail: gate.user.email,
		adminId: gate.user.id,
		grantUrl: parsed.data.grantUrl,
		phase: parsed.data.phase,
		themeProjectId: id,
	})
	return ok(result)
})
