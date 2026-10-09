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
		where: { id, deletedAt: null },
		select: { userId: true, theme: true, submissionExtensionUntil: true },
	})
	if (!before) return fail("NOT_FOUND", "Project not found")

	const data: { submissionExtensionUntil?: Date | null; theme?: Theme; warmupPhase?: null } = {}
	if (parsed.data.submissionExtensionUntil !== undefined)
		data.submissionExtensionUntil = parsed.data.submissionExtensionUntil

	if (parsed.data.theme !== undefined && parsed.data.theme !== before.theme) {
		if (parsed.data.theme !== Theme.WARMUP) {
			const clash = await prisma.themeProject.findFirst({
				where: { userId: before.userId, theme: parsed.data.theme, deletedAt: null, id: { not: id } },
				select: { id: true },
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
			where: { id },
			data,
			select: { id: true, theme: true, submissionExtensionUntil: true },
		})
	} catch {
		return fail("CONFLICT", "That maker already has a live project on the target theme")
	}

	if (data.submissionExtensionUntil !== undefined) {
		await logAudit({
			action: AuditAction.ADMIN_GRANT_EXTENSION,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "ThemeProject",
			targetId: id,
			metadata: {
				before: before.submissionExtensionUntil?.toISOString() ?? null,
				after: updated.submissionExtensionUntil?.toISOString() ?? null,
			},
		})
	}

	if (data.theme !== undefined) {
		await logAudit({
			action: AuditAction.ADMIN_MOVE_PROJECT,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "ThemeProject",
			targetId: id,
			metadata: { before: before.theme, after: updated.theme },
		})
	}

	return ok({ project: updated })
})
