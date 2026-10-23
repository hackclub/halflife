"use client"

import { useEffect, useState } from "react"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { EventForm } from "@/app/components/forms/EventForm"
import { Badge, Callout, EmptyState, Panel } from "@/app/components/ui"
import { type CalendarEvent, calendarDay, dayLabel, eventColour, eventRangeLabel } from "@/lib/events"

/**
 * The admin half of the calendar: the form, and the list it writes.
 *
 * Split into two components rather than one page because the form and the list are
 * the same object seen twice – editing a row opens it in the form above, so there
 * is one place that decides what an event looks like. A separate edit page would
 * have meant the same field list twice, and the two would drift.
 *
 * One row is one occurrence. A ten-week series is ten rows, because that is what
 * lets one week's call be moved without touching the other nine.
 */
export function EventScheduleManager({ events, timeZone }: { events: CalendarEvent[]; timeZone: string }) {
	const [editing, setEditing] = useState<CalendarEvent | null>(null)
	// The form enters times in the browser's own zone, so the list has to show them in the same one. `timeZone` is the programme's, which is only the right answer for an admin sitting in it – everyone else saw every event shifted by the difference. The first render keeps the programme's zone so the server and client markup agree, then this corrects it after mount, exactly like the header calendar.
	const [viewerZone, setViewerZone] = useState(timeZone)
	const [formVersion, setFormVersion] = useState(0)
	const today = calendarDay(new Date(), viewerZone)

	useEffect(() => {
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
		if (zone) setViewerZone(zone)
	}, [])

	// Closing the form is also what clears it. Bumping the version remounts it, which is the only way the `useState` initialisers run again – without this, Clear did nothing and a saved event left its values sitting in the create form, one more click away from a duplicate.
	function closeForm() {
		setEditing(null)
		setFormVersion(version => version + 1)
	}

	// The list reads in the order people ask questions in: what's next, then what
	// has already happened. Splitting it here rather than sorting twice keeps the
	// boundary honest – "past" is decided once, by the day.
	const upcoming = events.filter(event => calendarDay(event.startsAt, viewerZone) >= today)
	const past = events.filter(event => calendarDay(event.startsAt, viewerZone) < today).toReversed()

	const seriesCount = new Map<string, number>()
	for (const event of events)
		if (event.seriesId) seriesCount.set(event.seriesId, (seriesCount.get(event.seriesId) ?? 0) + 1)

	return (
		<div className="hl-stack">
			<div id="event-form" style={{ scrollMarginTop: "1rem" }}>
				<Panel title={editing ? "Editing an event" : "Add an event"}>
					{/* Keyed by the row being edited, so opening a different event remounts the
            form and its `useState` initialisers run again. Without the key the
            first render's values stick, and Edit opens a blank form. The version
            also changes when the form closes, which is what resets it after a save
            or Clear. */}
					<EventForm
						editing={editing}
						events={events}
						key={`${editing?.id ?? "new"}-${formVersion}`}
						// Closing on save is the whole update path: the data on screen came
						// from the server, so a refresh is what puts the new row in it.
						onDone={closeForm}
					/>
					{editing ? (
						<p className="hl-hint" style={{ marginBottom: 0, marginTop: "0.75rem" }}>
							Editing this one week only. The rest of its series are separate rows.
						</p>
					) : null}
				</Panel>
			</div>

			<Panel
				actions={
					upcoming.length > 0 ? (
						<ActionButton
							confirm={`Delete all ${upcoming.length} upcoming event${upcoming.length === 1 ? "" : "s"}? This cannot be undone.`}
							label="Clear all upcoming"
							method="DELETE"
							url="/api/admin/events"
							variant="danger"
						/>
					) : undefined
				}
				title={`Upcoming (${upcoming.length})`}
			>
				{upcoming.length === 0 ? (
					<EmptyState>Nothing scheduled.</EmptyState>
				) : (
					<RowTable events={upcoming} onEdit={setEditing} seriesCount={seriesCount} timeZone={viewerZone} />
				)}
			</Panel>

			{past.length > 0 && (
				<Panel title={`Past (${past.length})`}>
					<RowTable events={past} onEdit={setEditing} seriesCount={seriesCount} timeZone={viewerZone} />
				</Panel>
			)}
		</div>
	)
}

function RowTable({
	events,
	timeZone,
	seriesCount,
	onEdit,
}: {
	events: CalendarEvent[]
	timeZone: string
	seriesCount: Map<string, number>
	onEdit(event: CalendarEvent): void
}) {
	return (
		<div className="hl-scroll">
			<table className="hl-table">
				<thead>
					<tr>
						<th>When</th>
						<th>Event</th>
						<th>Colour</th>
						<th>Series</th>
						<th>Visible</th>
						<th />
					</tr>
				</thead>
				<tbody>
					{events.map(event => {
						const colour = eventColour(event.colour)
						const series = event.seriesId ? (seriesCount.get(event.seriesId) ?? 1) : 0
						return (
							<tr key={event.id}>
								<td>
									<div className="hl-mono">
										{dayLabel(calendarDay(event.startsAt, timeZone))}
										<div className="hl-muted">{eventRangeLabel(event.startsAt, event.endsAt, timeZone)}</div>
									</div>
								</td>
								<td>
									<div>{event.title}</div>
									{event.description ? <div className="hl-muted">{event.description}</div> : null}
								</td>
								<td>
									<span className="hl-row" style={{ gap: "0.4rem" }}>
										<span
											aria-hidden="true"
											className="inline-block size-3.5 rounded-full border border-line"
											style={{ background: colour.accent }}
										/>
										{colour.label}
									</span>
								</td>
								<td className="hl-mono">{series > 1 ? `×${series}` : "—"}</td>
								<td>
									<Badge tone={event.published ? "success" : "muted"}>{event.published ? "published" : "draft"}</Badge>
								</td>
								<td className="hl-row" style={{ gap: "0.5rem" }}>
									<button
										className="hl-btn"
										onClick={() => {
											onEdit(event)
											// The form sits above the list, so on a calendar long enough to scroll, Edit looked like it did nothing. Scroll to the panel here, where it already exists, rather than in an effect waiting for the rows to be swapped in.
											document.querySelector("#event-form")?.scrollIntoView({ behavior: "smooth", block: "start" })
										}}
										type="button"
									>
										Edit
									</button>
									<ActionButton
										body={{ published: !event.published }}
										label={event.published ? "Unpublish" : "Publish"}
										method="PATCH"
										url={`/api/admin/events/${event.id}`}
									/>
									<ActionButton
										confirm={`Delete "${event.title}" on ${dayLabel(calendarDay(event.startsAt, timeZone))}? This cannot be undone. Unpublish it instead if it still happens.`}
										label="Delete"
										method="DELETE"
										url={`/api/admin/events/${event.id}`}
									/>
								</td>
							</tr>
						)
					})}
				</tbody>
			</table>
		</div>
	)
}

/** Kept next to the tables it explains, so the note cannot describe the old one. */
export function EventScheduleNote() {
	return (
		<Callout tone="info">
			Times are entered and listed in your own timezone; participants see them in theirs. A repeating event is written
			as separate rows, so a single week can be moved or cancelled without touching the rest.
		</Callout>
	)
}
