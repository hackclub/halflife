"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { EVENT_KINDS, type CalendarEvent, eventKind } from "@/lib/events"

const WEEK_MS = 7 * 86_400_000

/** A Date as the value a datetime-local input takes, in this browser's zone. */
function toLocalInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
	return local.toISOString().slice(0, 16)
}

/** The label for a series, so "the weekly call" reads as one thing on the list. */
function seriesLabel(events: CalendarEvent[], event: CalendarEvent): string | null {
	if (!event.seriesId) return null
	const count = events.filter((e) => e.seriesId === event.seriesId).length
	return count > 1 ? `${count} in this series` : null
}

/**
 * Add an event to the programme calendar, or edit the one that is open.
 *
 * `repeatWeeks` writes the whole series in one request rather than making an admin
 * press the button once per week. It disappears when editing, because a series is
 * edited an occurrence at a time on purpose – that is the edit that gets made when
 * one week's call lands on a holiday.
 *
 * The kind is a select rather than free text because the calendar's colour comes
 * from it, and an unrecognised kind would render as "Other" after the fact.
 */
export function EventForm({
	events,
	editing,
	onDone,
}: {
	/** The whole calendar, so an edited row can say how long its series is. */
	events: CalendarEvent[]
	/** The occurrence being edited, or null to add a new one. */
	editing: CalendarEvent | null
	onDone: () => void
}) {
	const router = useRouter()
	const [title, setTitle] = useState(editing?.title ?? "")
	const [kind, setKind] = useState(editing?.kind ?? EVENT_KINDS[0].id)
	const [description, setDescription] = useState(editing?.description ?? "")
	const [startsAt, setStartsAt] = useState(editing ? toLocalInput(new Date(editing.startsAt)) : "")
	const [endsAt, setEndsAt] = useState(editing?.endsAt ? toLocalInput(new Date(editing.endsAt)) : "")
	const [location, setLocation] = useState(editing?.location ?? "")
	const [link, setLink] = useState(editing?.link ?? "")
	const [published, setPublished] = useState(editing?.published ?? true)
	const [repeatWeeks, setRepeatWeeks] = useState(1)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit(e: React.FormEvent) {
		e.preventDefault()
		setBusy(true)
		setError(null)

		const body: Record<string, unknown> = {
			title,
			kind,
			description: description || null,
			startsAt: startsAt ? new Date(startsAt).toISOString() : null,
			endsAt: endsAt ? new Date(endsAt).toISOString() : null,
			location: location || null,
			link: link || null,
			published,
			// Only meaningful on a create; the update schema has no such field and
			// `.strict()` would refuse the whole body for carrying one.
			...(editing ? {} : { repeatWeeks }),
		}

		try {
			const res = await fetch(editing ? `/api/admin/events/${editing.id}` : "/api/admin/events", {
				method: editing ? "PATCH" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Request failed (${res.status})`)
				return
			}
			onDone()
			router.refresh()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not reach the server")
		} finally {
			setBusy(false)
		}
	}

	const series = editing ? seriesLabel(events, editing) : null
	const missing = !title.trim() || !startsAt

	return (
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}

			<div className="hl-row" style={{ alignItems: "flex-end" }}>
				<Field label="What is it" hint="What participants would call it in Slack.">
					<input
						className="hl-input"
						value={title}
						onChange={(e) => setTitle(e.target.value)}
						placeholder="Weekly office hours"
						maxLength={120}
						required
					/>
				</Field>
				<Field label="Kind" hint="Decides the colour it wears on the calendar.">
					<select className="hl-select" value={kind} onChange={(e) => setKind(e.target.value as CalendarEvent["kind"])}>
						{EVENT_KINDS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
				</Field>
			</div>

			<div className="hl-row" style={{ alignItems: "flex-end" }}>
				<Field label="Starts" hint="Your own timezone. Stored as an instant.">
					<input
						className="hl-input"
						type="datetime-local"
						value={startsAt}
						onChange={(e) => setStartsAt(e.target.value)}
						required
					/>
				</Field>
				<Field label="Ends" hint="Optional. Leave blank for an open call.">
					<input
						className="hl-input"
						type="datetime-local"
						value={endsAt}
						onChange={(e) => setEndsAt(e.target.value)}
						min={startsAt || undefined}
					/>
				</Field>
			</div>

			<Field label="Description" hint="Optional. An agenda, or what to bring.">
				<textarea
					className="hl-textarea"
					value={description}
					onChange={(e) => setDescription(e.target.value)}
					rows={3}
					maxLength={2000}
				/>
			</Field>

			<div className="hl-row" style={{ alignItems: "flex-end" }}>
				<Field label="Where" hint="Optional. A room, a channel, or 'your own desk'.">
					<input
						className="hl-input"
						value={location}
						onChange={(e) => setLocation(e.target.value)}
						placeholder="The Discord stage"
						maxLength={200}
					/>
				</Field>
				<Field label="Link" hint="Optional. https only.">
					<input
						className="hl-input"
						type="url"
						value={link}
						onChange={(e) => setLink(e.target.value)}
						placeholder="https://meet.google.com/…"
					/>
				</Field>
			</div>

			<div className="hl-row" style={{ alignItems: "flex-end" }}>
				<Field
					label={editing ? "Visibility" : "Repeat weekly"}
					hint={
						editing
							? series ?? "Publishing is what puts it on participants' calendars."
							: "A standing weekly call is one row here, not ten. Each week is still its own occurrence, so one can be moved later."
					}
				>
					{editing ? (
						<label className="hl-row" style={{ minHeight: "2.5rem" }}>
							<input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
							{published ? "Published" : "Draft (hidden from participants)"}
						</label>
					) : (
						<select
							className="hl-select"
							value={repeatWeeks}
							onChange={(e) => setRepeatWeeks(Number(e.target.value))}
						>
							<option value={1}>Just this once</option>
							<option value={2}>Every week for 2 weeks</option>
							<option value={4}>Every week for 4 weeks</option>
							<option value={6}>Every week for 6 weeks</option>
							<option value={10}>Every week for all 10 weeks</option>
							<option value={12}>Every week for 12 weeks</option>
						</select>
					)}
				</Field>
			</div>

			<div className="hl-row">
				<Button type="submit" variant="primary" disabled={busy || missing}>
					{busy ? "Saving…" : editing ? "Save this event" : "Add to the calendar"}
				</Button>
				<Button type="button" onClick={onDone} disabled={busy}>
					{editing ? "Cancel" : "Clear"}
				</Button>
				<span className="hl-hint" style={{ margin: 0 }}>
					{eventKind(kind).label} · {published ? "published" : "draft"}
				</span>
			</div>

			{/* The first few of a long series, so an admin can see the run they are
              about to write before writing it. */}
			{!editing && repeatWeeks > 1 && startsAt ? (
				<p className="hl-hint" style={{ margin: 0 }}>
					{repeatWeeks} occurrences, every {WEEK_MS / 86_400_000} days from{" "}
					{new Date(startsAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })} to{" "}
					{new Date(new Date(startsAt).getTime() + (repeatWeeks - 1) * WEEK_MS).toLocaleDateString("en-US", {
						month: "short",
						day: "numeric",
						year: "numeric",
					})}
					.
				</p>
			) : null}
		</form>
	)
}