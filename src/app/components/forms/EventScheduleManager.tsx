"use client"

import { useState } from "react"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { EventForm } from "@/app/components/forms/EventForm"
import { Badge, Callout, EmptyState, Panel } from "@/app/components/ui"
import type { CalendarEvent } from "@/lib/events"
import { calendarDay, dayLabel, eventColour, eventRangeLabel } from "@/lib/events"

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
	const today = calendarDay(new Date(), timeZone)

	// The list reads in the order people ask questions in: what's next, then what
	// has already happened. Splitting it here rather than sorting twice keeps the
	// boundary honest – "past" is decided once, by the day.
	const upcoming = events.filter(event => calendarDay(event.startsAt, timeZone) >= today)
	const past = events.filter(event => calendarDay(event.startsAt, timeZone) < today).reverse()

	const seriesCount = new Map<string, number>()
	for (const event of events)
		if (event.seriesId) seriesCount.set(event.seriesId, (seriesCount.get(event.seriesId) ?? 0) + 1)

	return (
		<div className="hl-stack">
			<Panel title={editing ? "Editing an event" : "Add an event"}>
				{/* Keyed by the row being edited, so opening a different event remounts the
            form and its `useState` initialisers run again. Without the key the
            first render's values stick, and Edit opens a blank form. */}
				<EventForm
					editing={editing}
					events={events}
					key={editing?.id ?? "new"}
					// Closing on save is the whole update path: the data on screen came
					// from the server, so a refresh is what puts the new row in it.
					onDone={() => setEditing(null)}
				/>
				{editing ? (
					<p className="hl-hint" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
						Editing this one week only. The rest of its series are separate rows.
					</p>
				) : null}
			</Panel>

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
					<RowTable events={upcoming} onEdit={setEditing} seriesCount={seriesCount} timeZone={timeZone} />
				)}
			</Panel>

			{past.length > 0 && (
				<Panel title={`Past (${past.length})`}>
					<RowTable events={past} onEdit={setEditing} seriesCount={seriesCount} timeZone={timeZone} />
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
	onEdit: (event: CalendarEvent) => void
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
									<button className="hl-btn" onClick={() => onEdit(event)} type="button">
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
			Times are entered in your own timezone and shown to participants in theirs. A repeating event is written as
			separate rows, so a single week can be moved or cancelled without touching the rest.
		</Callout>
	)
}
