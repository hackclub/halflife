"use client"

import { useState } from "react"
import { Button, Callout, Field, TextInput } from "@/app/components/ui"
import { DAY_MS } from "@/lib/time"
import { sendJson, useAction } from "@/lib/use-action"

/** A YYYY-MM-DD plus some days, as a short label. Calendar arithmetic only, so UTC. */
function dayLabel(ymd: string, plusDays: number): string {
	const d = new Date(Date.parse(`${ymd}T00:00:00Z`) + plusDays * DAY_MS)
	return d.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC", weekday: "short" })
}

/**
 * When week 1 (PCB design) begins. Everything else is counted from it: every week number, and the Sunday-midnight close that greys a week out on the trail and stops it taking journal entries. So the form says what a new date would do before it is saved rather than after.
 */
export function ProgramStartForm({
	initial,
	timezone,
	weeks,
}: Readonly<{
	/** YYYY-MM-DD */
	initial: string
	timezone: string
	/** Label for each week in order, e.g. "PCBs · design". */
	weeks: string[]
}>) {
	const [date, setDate] = useState(initial)
	const [saved, setSaved] = useState(false)
	const { busy, error, run } = useAction()

	const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
	const monday = valid && new Date(`${date}T00:00:00Z`).getUTCDay() === 1
	const changed = date !== initial

	function save() {
		if (
			!window.confirm(
				"Moving the start moves every week for everyone: weeks can lock or reopen on the map the moment this saves. Continue?",
			)
		)
			return
		void run(
			"save",
			() => sendJson("/api/admin/program", { body: { eventStartDate: date }, method: "PATCH" }),
			() => setSaved(true),
		)
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{saved ? <Callout>Saved. The schedule below is the new one.</Callout> : null}

			<Field
				hint={`Each week closes at 11:59 PM on its seventh day, ${timezone} time.`}
				label="Week 1 starts (PCB design)"
			>
				<div className="hl-row">
					<TextInput
						onChange={e => {
							setDate(e.target.value)
							setSaved(false)
						}}
						style={{ maxWidth: "12rem" }}
						type="date"
						value={date}
					/>
					<Button disabled={busy !== null || !valid || !changed} onClick={save} variant="primary">
						{busy ? "Saving…" : "Save start date"}
					</Button>
					{changed ? (
						<Button disabled={busy !== null} onClick={() => setDate(initial)}>
							Undo
						</Button>
					) : null}
				</div>
			</Field>

			{valid && !monday ? (
				<Callout tone="warning">
					{dayLabel(date, 0).split(",")[0]} start: weeks will run {dayLabel(date, 0).split(",")[0]} to{" "}
					{dayLabel(date, 6).split(",")[0]} and close then, not on Sunday night.
				</Callout>
			) : null}

			{valid && changed ? (
				<div>
					<p className="hl-hint" style={{ margin: "0 0 0.35rem" }}>
						With this date:
					</p>
					<ul className="hl-hint" style={{ margin: 0, paddingLeft: "1.1rem" }}>
						{weeks.map((label, i) => (
							<li key={label}>
								Week {i + 1} ({label}): {dayLabel(date, i * 7)} to {dayLabel(date, i * 7 + 6)}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</div>
	)
}
