import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { getUserDetail } from "@/lib/queries/admin"
import { userFlagsSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

export const GET = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.VIEW_USERS)
	if (gate.error) return gate.error
	const { id } = await params

	const detail = await getUserDetail(id)
	if (!detail) return fail("NOT_FOUND", "User not found")
	return ok(detail)
})

export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_USERS)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, userFlagsSchema)
	if (parsed.error) return parsed.error

	const before = await prisma.user.findUnique({
		where: { id },
		select: { fraudFlagged: true, submissionExtensionUntil: true },
	})
	if (!before) return fail("NOT_FOUND", "User not found")

	const updated = await prisma.user.update({
		where: { id },
		data: {
			...(parsed.data.fraudFlagged !== undefined ? { fraudFlagged: parsed.data.fraudFlagged } : {}),
			...(parsed.data.submissionExtensionUntil !== undefined
				? { submissionExtensionUntil: parsed.data.submissionExtensionUntil }
				: {}),
		},
		select: { id: true, fraudFlagged: true, submissionExtensionUntil: true },
	})

	if (parsed.data.fraudFlagged !== undefined && parsed.data.fraudFlagged !== before.fraudFlagged) {
		await logAudit({
			action: parsed.data.fraudFlagged ? AuditAction.ADMIN_FLAG_FRAUD : AuditAction.ADMIN_UNFLAG_FRAUD,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "User",
			targetId: id,
			metadata: { before: before.fraudFlagged, after: parsed.data.fraudFlagged },
		})
	}
	if (parsed.data.submissionExtensionUntil !== undefined) {
		await logAudit({
			action: AuditAction.ADMIN_GRANT_EXTENSION,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "User",
			targetId: id,
			metadata: {
				before: before.submissionExtensionUntil?.toISOString() ?? null,
				after: parsed.data.submissionExtensionUntil?.toISOString() ?? null,
			},
		})
	}

	return ok({ user: updated })
})
