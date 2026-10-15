import { Theme } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { projectExtensionSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

/**
 * One project's extension and/or theme. The extension reopens that project alone – its passed weeks take journal entries again, and it can be submitted past a global close – where the user-level one on /api/admin/users/[id] covers everything they own. The theme move re-files a project (warm-up to week 1, say) without touching its review state.
 */
export const PATCH = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_PROGRAM)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, projectExtensionSchema)
	if (parsed.error) return parsed.error

	const before = await prisma.themeProject.findFirst({
		select: { submissionExtensionUntil: true, theme: true, userId: true },
		where: { deletedAt: null, id },
	})
	if (!before) return fail("NOT_FOUND", "Project not found")

	const data: { submissionExtensionUntil?: Date | null; theme?: Theme; warmupPhase?: null } = {}
	if (parsed.data.submissionExtensionUntil !== undefined)
		data.submissionExtensionUntil = parsed.data.submissionExtensionUntil

	if (parsed.data.theme !== undefined && parsed.data.theme !== before.theme) {
		if (parsed.data.theme !== Theme.WARMUP) {
			const clash = await prisma.themeProject.findFirst({
				select: { id: true },
				where: { deletedAt: null, id: { not: id }, theme: parsed.data.theme, userId: before.userId },
			})
			if (clash) return fail("CONFLICT", "That maker already has a live project on the target theme")
		}
		data.theme = parsed.data.theme
		// Season rows never carry a warm-up phase; warm-up rows keep whatever they had (null means "infer from status").
		if (parsed.data.theme !== Theme.WARMUP) data.warmupPhase = null
	}

	if (Object.keys(data).length === 0) return ok({ project: { id } })

	let updated: { id: string; theme: Theme; submissionExtensionUntil: Date | null }
	try {
		updated = await prisma.themeProject.update({
			data,
			select: { id: true, submissionExtensionUntil: true, theme: true },
			where: { id },
		})
	} catch {
		return fail("CONFLICT", "That maker already has a live project on the target theme")
	}

	if (data.submissionExtensionUntil !== undefined) {
		await logAudit({
			action: AuditAction.ADMIN_GRANT_EXTENSION,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: {
				after: updated.submissionExtensionUntil?.toISOString() ?? null,
				before: before.submissionExtensionUntil?.toISOString() ?? null,
			},
			targetId: id,
			targetType: "ThemeProject",
		})
	}

	if (data.theme !== undefined) {
		await logAudit({
			action: AuditAction.ADMIN_MOVE_PROJECT,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { after: updated.theme, before: before.theme },
			targetId: id,
			targetType: "ThemeProject",
		})
	}

	return ok({ project: updated })
})
