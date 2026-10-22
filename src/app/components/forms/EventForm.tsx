"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { cx } from "@/lib/cx"
import { formatShortDate, toLocalInput } from "@/lib/deadline"
import { type CalendarEvent, EVENT_COLOURS, type EventColour, eventColour, HUDDLE_URL } from "@/lib/events"

const WEEK_MS = 7 * 86_400_000

/** The label for a series, so "the weekly call" reads as one thing on the list. */
function seriesLabel(events: CalendarEvent[], event: CalendarEvent): string | null {
	if (!event.seriesId) return null
	const count = events.filter(e => e.seriesId === event.seriesId).length
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
 * The colour is a row of swatches rather than a text select, because the colour is
 * the only thing a participant actually sees: the field used to be a "kind" with
 * labels nobody read, and picking the label to pick the colour was a step that
 * asked an admin to translate in their head.
 *
 * There is no link field: every event is the Slack huddle, so the URL is a constant
 * in `lib/events.ts` rather than a column nobody would ever vary.
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
	onDone(): void
}) {
	const router = useRouter()
	const [title, setTitle] = useState(editing?.title ?? "")
	const [colour, setColour] = useState<EventColour>(editing?.colour ?? EVENT_COLOURS[0].id)
	const [description, setDescription] = useState(editing?.description ?? "")
	const [startsAt, setStartsAt] = useState(editing ? toLocalInput(new Date(editing.startsAt)) : "")
	const [endsAt, setEndsAt] = useState(editing?.endsAt ? toLocalInput(new Date(editing.endsAt)) : "")
	const [published, setPublished] = useState(editing?.published ?? true)
	const [repeatWeeks, setRepeatWeeks] = useState(1)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit(e: React.SubmitEvent) {
		e.preventDefault()
		setBusy(true)
		setError(null)

		const body: { [_: string]: unknown } = {
			colour,
			description: description || null,
			endsAt: endsAt ? new Date(endsAt).toISOString() : null,
			published,
			startsAt: startsAt ? new Date(startsAt).toISOString() : null,
			title,
			// Only meaningful on a create; the update schema has no such field and
			// `.strict()` would refuse the whole body for carrying one.
			...(editing ? {} : { repeatWeeks }),
		}

		try {
			const res = await fetch(editing ? `/api/admin/events/${editing.id}` : "/api/admin/events", {
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
				method: editing ? "PATCH" : "POST",
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
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}

			<div className="hl-row" style={{ alignItems: "flex-end" }}>
				<Field hint="What participants would call it in Slack." label="What is it">
					<input
						className="hl-input"
						maxLength={120}
						onChange={e => setTitle(e.target.value)}
						placeholder="Weekly office hours"
						required
						value={title}
					/>
				</Field>
				{/* Outside `Field`, which renders a `<label>`: a radio group is not its
            control, and nesting the two would make the label's own name ambiguous. */}
				<div className="hl-stack hl-stack--tight" style={{ gap: "0.25rem" }}>
					<span className="hl-label-text">Colour</span>
					<span aria-label="Colour" className="hl-row" role="radiogroup" style={{ gap: "0.4rem", minHeight: "2.5rem" }}>
						{EVENT_COLOURS.map(option => (
							// biome-ignore lint/a11y/useSemanticElements: a radio option drawn as a swatch.
							<button
								aria-checked={option.id === colour}
								aria-label={option.label}
								className={cx(
									"size-8 rounded-full border-2 transition-transform",
									option.id === colour ? "border-navy" : "border-line hover:scale-110",
								)}
								key={option.id}
								onClick={() => setColour(option.id)}
								role="radio"
								style={{ background: option.accent }}
								title={option.label}
								type="button"
							/>
						))}
					</span>
					<span className="hl-hint">The colour it wears on the calendar.</span>
				</div>
			</div>

			<div className="hl-row" style={{ alignItems: "flex-end" }}>
				<Field hint="Your own timezone. Stored as an instant." label="Starts">
					<input
						className="hl-input"
						onChange={e => setStartsAt(e.target.value)}
						required
						type="datetime-local"
						value={startsAt}
					/>
				</Field>
				<Field hint="Optional. Leave blank for an open call." label="Ends">
					<input
						className="hl-input"
						min={startsAt || undefined}
						onChange={e => setEndsAt(e.target.value)}
						type="datetime-local"
						value={endsAt}
					/>
				</Field>
			</div>

			<Field hint="Optional. An agenda, or what to bring." label="Description">
				<textarea
					className="hl-textarea"
					maxLength={2000}
					onChange={e => setDescription(e.target.value)}
					rows={3}
					value={description}
				/>
			</Field>

			{editing ? (
				<label className="hl-row" style={{ gap: "0.5rem" }}>
					<input checked={published} onChange={e => setPublished(e.target.checked)} type="checkbox" />
					<span>{published ? "Published" : "Draft (hidden from participants)"}</span>
					{series ? <span className="hl-hint">{series}</span> : null}
				</label>
			) : (
				<Field
					hint="A standing weekly call is one row here, not ten. Each week is still its own occurrence, so one can be moved later."
					label="Repeat weekly"
				>
					<select className="hl-select" onChange={e => setRepeatWeeks(Number(e.target.value))} value={repeatWeeks}>
						<option value={1}>Just this once</option>
						<option value={2}>Every week for 2 weeks</option>
						<option value={4}>Every week for 4 weeks</option>
						<option value={6}>Every week for 6 weeks</option>
						<option value={10}>Every week for all 10 weeks</option>
						<option value={12}>Every week for 12 weeks</option>
					</select>
				</Field>
			)}

			<div className="hl-row">
				<Button disabled={busy || missing} type="submit" variant="primary">
					{busy ? "Saving…" : editing ? "Save this event" : "Add to the calendar"}
				</Button>
				<Button disabled={busy} onClick={onDone} type="button">
					{editing ? "Cancel" : "Clear"}
				</Button>
				<span className="hl-hint" style={{ margin: 0 }}>
					{eventColour(colour).label} · every event joins the{" "}
					<a href={HUDDLE_URL} rel="noreferrer" target="_blank">
						Slack huddle
					</a>
				</span>
			</div>

			{/* The first few of a long series, so an admin can see the run they are
              about to write before writing it. */}
			{!editing && repeatWeeks > 1 && startsAt ? (
				<p className="hl-hint" style={{ margin: 0 }}>
					{repeatWeeks} occurrences, every {WEEK_MS / 86_400_000} days from {formatShortDate(startsAt)} to{" "}
					{new Date(new Date(startsAt).getTime() + (repeatWeeks - 1) * WEEK_MS).toLocaleDateString("en-US", {
						day: "numeric",
						month: "short",
						year: "numeric",
					})}
					.
				</p>
			) : null}
		</form>
	)
}
