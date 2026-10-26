import type { Models } from "@/app/generated/prisma8/contract.d"
import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { Theme } from "@/lib/enums"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { projectExtensionSchema } from "@/lib/schemas/admin"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string }>
}

/**
 * One project's extension and/or theme. The extension reopens that project alone – its passed weeks take journal entries again, and it can be submitted past a global close – where the user-level one on /api/admin/users/[id] covers everything they own. The theme move re-files a project (warm-up to week 1, say) without touching its review state.
 */
export const PATCH = withWritePermission(
	Permission.MANAGE_PROGRAM,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params

		const parsed = await parseBody(req, projectExtensionSchema)
		if (parsed.error) return parsed.error

		const before = await db.orm.public.ThemeProject.where({ deletedAt: null, id })
			.select("submissionExtensionUntil", "theme", "userId")
			.first()
		if (!before) return fail("NOT_FOUND", "Project not found")

		const data: { submissionExtensionUntil?: string | null; theme?: Theme; warmupPhase?: null } = {}
		if (parsed.data.submissionExtensionUntil !== undefined)
			data.submissionExtensionUntil = parsed.data.submissionExtensionUntil
				? formatDbTimestamp(parsed.data.submissionExtensionUntil)
				: null

		if (parsed.data.theme !== undefined && parsed.data.theme !== before.theme) {
			if (parsed.data.theme !== Theme.WARMUP) {
				const clash = await db.orm.public.ThemeProject.where({
					deletedAt: null,
					theme: parsed.data.theme,
					userId: before.userId,
				})
					.where(project => project.id.neq(id))
					.select("id")
					.first()
				if (clash) return fail("CONFLICT", "That maker already has a live project on the target theme")
			}
			data.theme = parsed.data.theme
			// Season rows never carry a warm-up phase; warm-up rows keep whatever they had (null means "infer from status").
			if (parsed.data.theme !== Theme.WARMUP) data.warmupPhase = null
		}

		if (Object.keys(data).length === 0) return ok({ project: { id } })

		let updated: Pick<Models.public_ThemeProject, "id" | "theme" | "submissionExtensionUntil">
		try {
			const row = await db.orm.public.ThemeProject.where({ id })
				.select("id", "theme", "submissionExtensionUntil")
				.update(data)
			if (!row) return fail("NOT_FOUND", "Project not found")
			updated = row
		} catch (err) {
			if (isUniqueViolation(err)) return fail("CONFLICT", "That maker already has a live project on the target theme")
			throw err
		}
		if (!updated) return fail("NOT_FOUND", "Project not found")

		if (data.submissionExtensionUntil !== undefined)
			await logAudit({
				action: AuditAction.ADMIN_GRANT_EXTENSION,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: {
					after:
						updated.submissionExtensionUntil === null
							? null
							: parseDbTimestamp(updated.submissionExtensionUntil).toISOString(),
					before:
						before.submissionExtensionUntil === null
							? null
							: parseDbTimestamp(before.submissionExtensionUntil).toISOString(),
				},
				targetId: id,
				targetType: "ThemeProject",
			})

		if (data.theme !== undefined)
			await logAudit({
				action: AuditAction.ADMIN_MOVE_PROJECT,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { after: updated.theme, before: before.theme },
				targetId: id,
				targetType: "ThemeProject",
			})

		return ok({
			project: {
				...updated,
				submissionExtensionUntil:
					updated.submissionExtensionUntil === null
						? null
						: parseDbTimestamp(updated.submissionExtensionUntil).toISOString(),
			},
		})
	},
)
