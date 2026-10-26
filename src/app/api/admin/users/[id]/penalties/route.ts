import { fail, ok, parseBody } from "@/lib/api"
import { Role } from "@/lib/enums"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { banUser, penaltyFor, suspendUser, unbanUser, unsuspendUser } from "@/lib/moderation"
import { hasRole, Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { penaltySchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const dynamic = "force-dynamic"

/** Current penalty state on the row, for the card on the admin page to render. */
export const GET = withWritePermission(Permission.VIEW_USERS, async (_req, { params }: Params & AuthedContext) => {
	const { id } = await params
	const row = await db.orm.public.User.whereUnique({ id })
		.select("bannedAt", "bannedById", "banReason", "suspendedById", "suspendedUntil", "suspensionReason")
		.first()
	if (!row) return fail("NOT_FOUND", "User not found")
	return ok({ penalty: penaltyFor(row.bannedAt, row.suspendedUntil), ...row })
})

/**
 * Hand a penalty down, or lift one.
 *
 * Applying one is access-changing - the firmest thing MANAGE_USERS can do - so the ADMIN role is required underneath the permission: `hasRole` is the extra pane of glass. Penalties are not aimed at staff: taking an account off the roster (MANAGE_ROLES) is how someone is removed from the team, since revoking ADMIN by direct action deserves its own trail.
 */
export const POST = withWritePermission(
	Permission.MANAGE_USERS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		if (!hasRole(gate.roles, Role.ADMIN)) return fail("FORBIDDEN", "Requires the ADMIN role")

		const parsed = await parseBody(req, penaltySchema)
		if (parsed.error) return parsed.error

		// Never on yourself: an admin who bans their own session has no way back in, and the undo button is unreachable too.
		if (id === gate.user.id) return fail("CONFLICT", "You cannot place a penalty on your own account")

		const target = await db.orm.public.User.whereUnique({ id })
			.include("roles", roles => roles.select("role"))
			.select("id")
			.first()
		if (!target) return fail("NOT_FOUND", "User not found")
		if (target.roles.some(r => r.role === Role.ADMIN))
			return fail("CONFLICT", "Remove their ADMIN role before penalising them")

		// The business rules live in lib/moderation and throw HttpError for everything the admin needs to hear back, which withRoute already turns into the proper response. Nothing to re-word here.
		const { action } = parsed.data
		if (action === "SUSPEND")
			await suspendUser({ byId: gate.user.id, reason: parsed.data.reason, until: parsed.data.until, userId: id })
		else if (action === "BAN")
			await banUser({
				byId: gate.user.id,
				hideContent: parsed.data.hideContent,
				reason: parsed.data.reason,
				userId: id,
			})
		else if (action === "UNSUSPEND") await unsuspendUser({ byId: gate.user.id, userId: id })
		else await unbanUser({ byId: gate.user.id, restoreContent: parsed.data.restoreContent, userId: id })

		const row = await db.orm.public.User.whereUnique({ id })
			.select("bannedAt", "bannedById", "banReason", "suspendedById", "suspendedUntil", "suspensionReason")
			.first()
		return ok({ penalty: row ? penaltyFor(row.bannedAt, row.suspendedUntil) : "none", ...row })
	},
)
