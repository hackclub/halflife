import { ok, withRoute } from "@/lib/api"
import { submitFloorFor } from "@/lib/config/printers"
import { scheduleForWeek, THEMES, TOTAL_WEEKS } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { currentWeekNumber, getProgramSettings, weekDateRange } from "@/lib/program"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
	const settings = await getProgramSettings()
	const currentWeek = await currentWeekNumber()
	const scheduled = scheduleForWeek(currentWeek)

	return ok({
		startDate: settings.eventStartDate,
		timezone: settings.programTimezone,
		totalWeeks: TOTAL_WEEKS,
		currentWeek,
		weekRange: weekDateRange(settings.eventStartDate, currentWeek),
		focus: scheduled ? { theme: scheduled.theme.slug, phase: scheduled.phase } : null,
		submissionsOpen: settings.submissionsOpen,
		shopOpen: settings.shopOpen,
		themes: THEMES.map((t) => ({
			slug: t.slug,
			label: t.label,
			blurb: t.blurb,
			designWeek: t.designWeek,
			buildWeek: t.buildWeek,
		})),
		tiers: TIERS.map((t) => ({
			id: t.id,
			name: t.name,
			grantUsd: t.grantUsd,
			fundingHours: t.fundingHours,
			submitFloorHours: submitFloorFor(t.fundingHours),
			blurb: t.blurb,
		})),
	})
})
