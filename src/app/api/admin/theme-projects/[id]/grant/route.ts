import { ok, parseBody } from "@/lib/api"
import { sendGrant } from "@/lib/grants"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { grantSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const maxDuration = 60

/**
 * Send a project's design grant to the maker's HCB card grant.
 *
 * A payout is a MANAGE_CREDIT action, not a review one: a reviewer decides what a project is worth, and granting the money is deliberately a different permission. Idempotent per (user, project, design) in lib/grants.
 */
export const POST = withPermission(
	Permission.MANAGE_CREDIT,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
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
	},
)
