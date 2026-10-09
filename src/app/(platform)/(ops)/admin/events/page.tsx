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
	const upcoming = nextEvent(events, new Date())

	return (
		<div className="hl-stack">
			<PageHeader
				title="Events"
				subtitle={
					upcoming
						? `Next: ${upcoming.title}. ${events.length} on the calendar.`
						: events.length > 0
							? "Nothing upcoming. Everything on the calendar has finished."
							: "Nothing scheduled yet."
				}
			/>

			<EventScheduleNote />

			<EventScheduleManager events={events} timeZone={settings.programTimezone} />
		</div>
	)
}
