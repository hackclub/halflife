import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { PayoutSource, Phase } from "@/lib/enums"
import { ABANDONED_ATTEMPT_MS } from "@/lib/grants"
import { withPermission, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { programSettingsSchema } from "@/lib/schemas/admin"
import { formatDbTimestamp, parseDbTimestamp, parseNullableTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

export const GET = withPermission(Permission.MANAGE_PROGRAM, async () => ok({ settings: await getProgramSettings() }))

const iso = (value: string | null): string | null => parseNullableTimestamp(value)?.toISOString() ?? null

/**
 * The kill switches live here rather than in env vars deliberately. Stasis put its submission gate in SUBMISSIONS_CLOSED and it was never flipped in the dashboard, so submissions silently stayed open for two weeks after the event ended. A row with a toggle and an audit trail cannot be forgotten.
 */
export const PATCH = withWritePermission(Permission.MANAGE_PROGRAM, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, programSettingsSchema)
	if (parsed.error) return parsed.error

	const before = await getProgramSettings()
	const { eventStartDate, shopClosesAt, submissionsCloseAt, ...rest } = parsed.data

	// Moving payouts off top-ups while one is in flight would hand the same design to a card batch: the top-up has claimed its row but not paid yet, and nothing else can see it. Only a send old enough to be abandoned is ignored, the same window the grant retry uses.
	if (
		rest.payoutSource !== undefined
		&& rest.payoutSource !== before.payoutSource
		&& rest.payoutSource !== PayoutSource.AIRTABLE
	) {
		const inFlight = await db.orm.public.HcbGrantTopUp.where({ phase: Phase.DESIGN, sentAt: null })
			.where(topUp => topUp.error.isNull())
			.where(topUp => topUp.createdAt.gt(formatDbTimestamp(new Date(Date.now() - ABANDONED_ATTEMPT_MS))))
			.select("id")
			.first()
		if (inFlight)
			return fail(
				"CONFLICT",
				"A grant top-up is being sent right now. Wait for it to finish before changing the payout source",
			)
	}

	const row = await db.orm.public.ProgramSettings.where({ id: "singleton" }).update({
		...rest,
		...(eventStartDate === undefined ? {} : { eventStartDate: formatDbTimestamp(eventStartDate) }),
		...(shopClosesAt === undefined ? {} : { shopClosesAt: shopClosesAt ? formatDbTimestamp(shopClosesAt) : null }),
		...(submissionsCloseAt === undefined
			? {}
			: { submissionsCloseAt: submissionsCloseAt ? formatDbTimestamp(submissionsCloseAt) : null }),
		updatedById: gate.user.id,
	})
	if (!row) return fail("NOT_FOUND", "Settings not found")
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
				payoutSource: settings.payoutSource,
				programTimezone: settings.programTimezone,
				repoSyncEnabled: settings.repoSyncEnabled,
				reviewClaimTtlMinutes: settings.reviewClaimTtlMinutes,
				shopClosesAt: settings.shopClosesAt,
				shopGraceDays: settings.shopGraceDays,
				shopOpen: settings.shopOpen,
				submissionsCloseAt: settings.submissionsCloseAt,
				submissionsOpen: settings.submissionsOpen,
			},
			before: {
				airtableSyncEnabled: before.airtableSyncEnabled,
				eventStartDate: before.eventStartDate.toISOString(),
				payoutSource: before.payoutSource,
				programTimezone: before.programTimezone,
				repoSyncEnabled: before.repoSyncEnabled,
				reviewClaimTtlMinutes: before.reviewClaimTtlMinutes,
				shopClosesAt: before.shopClosesAt?.toISOString() ?? null,
				shopGraceDays: before.shopGraceDays,
				shopOpen: before.shopOpen,
				submissionsCloseAt: before.submissionsCloseAt?.toISOString() ?? null,
				submissionsOpen: before.submissionsOpen,
			},
		},
		targetId: "singleton",
		targetType: "ProgramSettings",
	})

	return ok({ settings })
})
