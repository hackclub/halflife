import { ok, withRoute } from "@/lib/api"
import { submitFloorFor } from "@/lib/config/printers"
import { scheduleForWeek, THEMES, TOTAL_WEEKS } from "@/lib/config/program"
import { TIERS } from "@/lib/config/tiers"
import { currentWeekNumber, getProgramSettings, weekClosesAt, weekDateRange, weekOpensAt } from "@/lib/program"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
	const settings = await getProgramSettings()
	const currentWeek = await currentWeekNumber()
	const scheduled = scheduleForWeek(currentWeek)

	return ok({
		currentWeek,
		focus: scheduled ? { phase: scheduled.phase, theme: scheduled.theme.slug } : null,
		// The programme's last moment, which the openings cannot express: week 10 opening is the last week starting, not the programme being over, and a client counting openings alone would say it is finished a week early.
		programEndsAt: weekClosesAt(settings, TOTAL_WEEKS),
		shopOpen: settings.shopOpen,
		startDate: settings.eventStartDate,
		submissionsOpen: settings.submissionsOpen,
		themes: THEMES.map(t => ({
			blurb: t.blurb,
			buildWeek: t.buildWeek,
			designWeek: t.designWeek,
			label: t.label,
			slug: t.slug,
		})),
		tiers: TIERS.map(t => ({
			blurb: t.blurb,
			fundingHours: t.fundingHours,
			grantUsd: t.grantUsd,
			id: t.id,
			name: t.name,
			submitFloorHours: submitFloorFor(t.fundingHours),
		})),
		timezone: settings.programTimezone,
		totalWeeks: TOTAL_WEEKS,
		// Every week's opening instant, so a client can tell which week it is and count down to the next one without being asked again. The programme's calendar is worked out here, in its own timezone – a browser counting from `startDate` would get a week wrong by a few hours twice a year at a daylight-saving change, and once more for anyone not in the program's zone. Ten timestamps, and the browser never has to know how a week is drawn.
		weekOpensAt: Array.from({ length: TOTAL_WEEKS }, (_, i) => weekOpensAt(settings, i + 1)),
		weekRange: weekDateRange(settings, currentWeek),
	})
})
