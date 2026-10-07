import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { projectExtensionSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

export const dynamic = "force-dynamic"

/**
 * One project's extension. It reopens that project alone — its passed weeks
 * take journal entries again, and it can be submitted past a global close —
 * where the user-level one on /api/admin/users/[id] covers everything they own.
 */
export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, projectExtensionSchema)
	if (parsed.error) return parsed.error

	const before = await prisma.themeProject.findFirst({
		where: { id, deletedAt: null },
		select: { submissionExtensionUntil: true },
	})
	if (!before) return fail("NOT_FOUND", "Project not found")

	const updated = await prisma.themeProject.update({
		where: { id },
		data: { submissionExtensionUntil: parsed.data.submissionExtensionUntil },
		select: { id: true, submissionExtensionUntil: true },
	})

	await logAudit({
		action: AuditAction.ADMIN_GRANT_EXTENSION,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ThemeProject",
		targetId: id,
		metadata: {
			before: before.submissionExtensionUntil?.toISOString() ?? null,
			after: parsed.data.submissionExtensionUntil?.toISOString() ?? null,
		},
	})

	return ok({ project: updated })
})
