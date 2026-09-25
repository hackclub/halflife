import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission, Role } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { roleChangeSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_ROLES)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, roleChangeSchema)
  if (parsed.error) return parsed.error

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) return fail("NOT_FOUND", "User not found")

  const existing = await prisma.userRole.findUnique({
    where: { userId_role: { userId: id, role: parsed.data.role } },
  })
  if (existing) return fail("CONFLICT", "That user already holds this role")

  await prisma.userRole.create({
    data: { userId: id, role: parsed.data.role, grantedBy: gate.user.id },
  })

  await logAudit({
    action: AuditAction.ADMIN_GRANT_ROLE,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "User",
    targetId: id,
    metadata: { role: parsed.data.role },
  })

  return ok({ ok: true }, { status: 201 })
})

export const DELETE = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_ROLES)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, roleChangeSchema)
  if (parsed.error) return parsed.error

  // Locking everyone out of the admin surface is not a recoverable mistake in
  // a deployment where nobody has shell access.
  if (parsed.data.role === Role.ADMIN) {
    const admins = await prisma.userRole.count({ where: { role: Role.ADMIN } })
    if (admins <= 1) {
      return fail("LAST_ADMIN", "Cannot remove the last admin")
    }
  }

  await prisma.userRole.deleteMany({ where: { userId: id, role: parsed.data.role } })

  await logAudit({
    action: AuditAction.ADMIN_REVOKE_ROLE,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "User",
    targetId: id,
    metadata: { role: parsed.data.role },
  })

  return ok({ ok: true })
})
