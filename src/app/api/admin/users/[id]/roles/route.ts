import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { lockKey } from "@/lib/locks"
import { Permission, Role } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { roleChangeSchema } from "@/lib/schemas/admin"

interface Params {
	params: Promise<{ id: string }>
}

export const POST = withPermission(
	Permission.MANAGE_ROLES,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, roleChangeSchema)
		if (parsed.error) return parsed.error

		const user = await db.orm.public.User.whereUnique({ id }).select("id").first()
		if (!user) return fail("NOT_FOUND", "User not found")

		const existing = await db.orm.public.UserRole.where({
			role: parsed.data.role,
			userId: id,
		})
			.select("id")
			.first()
		if (existing) return fail("CONFLICT", "That user already holds this role")

		await db.orm.public.UserRole.create({ grantedBy: gate.user.id, role: parsed.data.role, userId: id })

		await logAudit({
			action: AuditAction.ADMIN_GRANT_ROLE,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { role: parsed.data.role },
			targetId: id,
			targetType: "User",
		})

		return ok({ ok: true }, { status: 201 })
	},
)

export const DELETE = withPermission(
	Permission.MANAGE_ROLES,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, roleChangeSchema)
		if (parsed.error) return parsed.error

		// Locking everyone out of the admin surface is not a recoverable mistake in a deployment where nobody has shell access. The check and the delete run in one transaction under an advisory lock: two concurrent revokes of the two remaining admins would otherwise both count two and both delete.
		await db.transaction(async tx => {
			if (parsed.data.role === Role.ADMIN) {
				await lockKey(tx, "admin-roles")
				const target = await tx.orm.public.UserRole.where({ role: Role.ADMIN, userId: id }).select("id").first()
				if (target) {
					const { count: admins } = await tx.orm.public.UserRole.where({ role: Role.ADMIN }).aggregate(a => ({
						count: a.count(),
					}))
					if (admins <= 1) throw new HttpError("LAST_ADMIN", "Cannot remove the last admin")
				}
			}

			await tx.orm.public.UserRole.where({ role: parsed.data.role, userId: id }).deleteAndCount()
		})

		await logAudit({
			action: AuditAction.ADMIN_REVOKE_ROLE,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { role: parsed.data.role },
			targetId: id,
			targetType: "User",
		})

		return ok({ ok: true })
	},
)
