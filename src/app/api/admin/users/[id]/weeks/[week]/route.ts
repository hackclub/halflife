import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { TOTAL_WEEKS } from "@/lib/config/program"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { weekExtensionSchema } from "@/lib/schemas/admin"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

interface Params {
	params: Promise<{ id: string; week: string }>
}

/**
 * One week's extension, granted on the week rather than on its project.
 *
 * The project row does not exist until the maker opens that week's checkpoint, and an admin still needs to give them time on a week they have not started. Writing the extension against the week means the grant survives that wait: `isWeekOpen` reads this row beside the project's own extension, and the trail's deadline picks it up for the week it names.
 */
export const PATCH = withWritePermission(
	Permission.MANAGE_USERS,
	async (req: Request, { params, gate }: Params & AuthedContext) => {
		const { id, week: weekText } = await params
		const week = Number(weekText)
		if (!Number.isInteger(week) || week < 1 || week > TOTAL_WEEKS)
			return fail("VALIDATION_FAILED", "Pick a week of the program")

		const parsed = await parseBody(req, weekExtensionSchema)
		if (parsed.error) return parsed.error

		const user = await db.orm.public.User.whereUnique({ id }).select("id").first()
		if (!user) return fail("NOT_FOUND", "User not found")

		const before = await db.orm.public.WeekExtension.whereUnique({ userId: id, week })
			.select("submissionExtensionUntil")
			.first()

		const until = parsed.data.submissionExtensionUntil
		if (until === null) await db.orm.public.WeekExtension.where({ userId: id, week }).deleteAndCount()
		else
			await db.orm.public.WeekExtension.upsert({
				conflictOn: { userId: id, week },
				create: { submissionExtensionUntil: formatDbTimestamp(until), userId: id, week },
				update: { submissionExtensionUntil: formatDbTimestamp(until) },
			})

		await logAudit({
			action: AuditAction.ADMIN_GRANT_EXTENSION,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: {
				after: until?.toISOString() ?? null,
				before: before ? parseDbTimestamp(before.submissionExtensionUntil).toISOString() : null,
				week,
			},
			targetId: id,
			targetType: "User",
		})

		return ok({ extension: until?.toISOString() ?? null, week })
	},
)
