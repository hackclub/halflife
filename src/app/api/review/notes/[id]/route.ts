import { fail, ok } from "@/lib/api"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { formatDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string }>
}

/** Removes a note, or clears a flag, which keeps the row as the record of who flagged the project and who cleared it. A note is removed by its author or an admin; a flag is cleared by its author or anyone who may override decisions. */
export const DELETE = withWritePermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		const note = await db.orm.public.ReviewNote.whereUnique({ id }).select("authorId", "clearedAt", "flag").first()
		if (!note || note.clearedAt) return fail("NOT_FOUND", "Note not found")

		const own = note.authorId === gate.user.id
		if (note.flag) {
			if (!own && !hasPermission(gate.roles, Permission.OVERRIDE_DECISIONS))
				return fail("FORBIDDEN", "Only the reviewer who flagged this project, or an admin, can clear the flag")
			await db.orm.public.ReviewNote.where({ id }).update({
				clearedAt: formatDbTimestamp(new Date()),
				clearedById: gate.user.id,
			})
			return ok({ id })
		}

		if (!own && !hasRole(gate.roles, Role.ADMIN))
			return fail("FORBIDDEN", "Only the note's author, or an admin, can remove it")
		await db.orm.public.ReviewNote.where({ id }).delete()
		return ok({ id })
	},
)
