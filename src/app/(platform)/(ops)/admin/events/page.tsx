import { EventScheduleManager, EventScheduleNote } from "@/app/components/forms/EventScheduleManager"
import { PageHeader } from "@/app/components/ui"
import { nextEvent } from "@/lib/events"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getProgramSettings } from "@/lib/program"
import { listAllEvents } from "@/lib/queries/events"

export const dynamic = "force-dynamic"

export default async function AdminEventsPage() {
	await requirePermissionPage(Permission.MANAGE_PROGRAM)

	const [events, settings] = await Promise.all([listAllEvents(), getProgramSettings()])
	// The header is about what participants will see next, so a draft must not be announced here. The list below still shows drafts, marked as such.
	const upcoming = nextEvent(
		events.filter(event => event.published),
		new Date(),
	)

	return (
		<div className="hl-stack">
			<PageHeader
				subtitle={
					upcoming
						? `Next: ${upcoming.title}. ${events.length} on the calendar.`
						: events.length > 0
							? "Nothing published is upcoming."
							: "Nothing scheduled yet."
				}
				title="Events"
			/>

			<EventScheduleNote />

			<EventScheduleManager events={events} timeZone={settings.programTimezone} />
		</div>
	)
}
