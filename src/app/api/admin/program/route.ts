import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withPermission, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { programSettingsSchema } from "@/lib/schemas/admin"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

export const GET = withPermission(Permission.MANAGE_PROGRAM, async () => ok({ settings: await getProgramSettings() }))

/**
 * The kill switches live here rather than in env vars deliberately. Stasis put its submission gate in SUBMISSIONS_CLOSED and it was never flipped in the dashboard, so submissions silently stayed open for two weeks after the event ended. A row with a toggle and an audit trail cannot be forgotten.
 */
export const PATCH = withWritePermission(Permission.MANAGE_PROGRAM, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, programSettingsSchema)
	if (parsed.error) return parsed.error

	const before = await getProgramSettings()
	const { eventStartDate, shopClosesAt, submissionsCloseAt, ...rest } = parsed.data
	const row = await db.orm.public.ProgramSettings.where({ id: "singleton" }).update({
		...rest,
		...(eventStartDate !== undefined ? { eventStartDate: formatDbTimestamp(eventStartDate) } : {}),
		...(shopClosesAt !== undefined ? { shopClosesAt: shopClosesAt ? formatDbTimestamp(shopClosesAt) : null } : {}),
		...(submissionsCloseAt !== undefined
			? { submissionsCloseAt: submissionsCloseAt ? formatDbTimestamp(submissionsCloseAt) : null }
			: {}),
		updatedById: gate.user.id,
	})
	if (!row) return fail("NOT_FOUND", "Settings not found")
	const iso = (value: string | null): string | null => (value === null ? null : parseDbTimestamp(value).toISOString())
	const settings = {
		...row,
		eventStartDate: parseDbTimestamp(row.eventStartDate).toISOString(),
		shopClosesAt: iso(row.shopClosesAt),
		submissionsCloseAt: iso(row.submissionsCloseAt),
	}

	await logAudit({
		action: AuditAction.ADMIN_UPDATE_PROGRAM_SETTINGS,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: {
			after: {
				airtableSyncEnabled: settings.airtableSyncEnabled,
				eventStartDate: settings.eventStartDate,
				repoSyncEnabled: settings.repoSyncEnabled,
				shopOpen: settings.shopOpen,
				submissionsOpen: settings.submissionsOpen,
			},
			before: {
				airtableSyncEnabled: before.airtableSyncEnabled,
				eventStartDate: before.eventStartDate.toISOString(),
				repoSyncEnabled: before.repoSyncEnabled,
				shopOpen: before.shopOpen,
				submissionsOpen: before.submissionsOpen,
			},
		},
		targetId: "singleton",
		targetType: "ProgramSettings",
	})

	return ok({ settings })
})
