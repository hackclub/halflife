import { z } from "zod"
import { fail, ok, parseBody } from "@/lib/api"
import { displayName } from "@/lib/display-name"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import db from "@/lib/prisma8"
import {
	isRobertConfigured,
	recordRobertOutcome,
	refreshFromRobert,
	submitToRobert,
	TelescreenError,
} from "@/lib/telescreen"

interface Params {
	params: Promise<{ id: string }>
}

const bodySchema = z.discriminatedUnion("action", [
	z.object({ action: z.literal("send") }),
	z.object({
		action: z.literal("outcome"),
		reason: z.string().max(5000).optional(),
		status: z.enum(["approved", "rejected"]),
	}),
])

/**
 * The review screen's Robert card (see lib/telescreen): send the project to Robert now and read it back, or, for admins, record our decision in Robert once its fraud review has passed.
 *
 * Held to the review screen's rules: REVIEW_SUBMISSIONS, and a 404 for your own work.
 */
export const POST = withWritePermission(
	Permission.REVIEW_SUBMISSIONS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const parsed = await parseBody(req, bodySchema)
		if (parsed.error) return parsed.error
		const submission = await db.orm.public.PhaseSubmission.whereUnique({ id: (await params).id })
			.select("themeProjectId")
			.include("themeProject", proj => proj.select("deletedAt", "id", "userId"))
			.first()
		const project = submission?.themeProject
		if (!project || project.deletedAt || project.userId === gate.user.id) return fail("NOT_FOUND", "Ship not found")
		if (!isRobertConfigured()) return fail("NOT_CONFIGURED", "Robert isn't set up. Add ROBERT_API_KEY first.")

		try {
			if (parsed.data.action === "send") {
				await submitToRobert(project.id, displayName(gate.user, "Reviewer"))
				await refreshFromRobert(project.id)
				return ok({ ok: true })
			}
			if (!hasRole(gate.roles, Role.ADMIN)) return fail("FORBIDDEN", "Only admins record outcomes in Robert")
			await recordRobertOutcome(project.id, parsed.data.status, parsed.data.reason ?? null)
			return ok({ ok: true })
		} catch (err) {
			if (err instanceof TelescreenError) return fail("CONFLICT", err.message)
			throw err
		}
	},
)
