"use client"

import { useState } from "react"
import { z } from "zod"
import { Badge, Button, Callout, Field, TextInput } from "@/app/components/ui"
import { Phase } from "@/lib/enums"
import { MAX_SESSION_HOURS } from "@/lib/schemas/session"
import { sendJsonParsed, useAction } from "@/lib/use-action"

/**
 * One journal entry as an admin sees it on a project. `locked` is a week in review, whose hours a reviewer is reading. `decided` is a week whose coins are already frozen, so a correction changes the record but not the payout.
 */
export interface JournalHoursEntry {
	decided: boolean
	effectiveDate: string | null
	hoursApproved: number | null
	hoursClaimed: number
	id: string
	locked: boolean
	phase: string
	title: string
}

const saveResponseSchema = z.object({ decided: z.boolean() })

/**
 * Every journal entry on a project, each with a way to correct its claimed hours.
 *
 * The participant could not fix an entry once its week was submitted, so this is where a wrong figure is caught after the fact.
 */
export function JournalHoursEditor({ entries }: Readonly<{ entries: JournalHoursEntry[] }>) {
	const [openId, setOpenId] = useState<string | null>(null)
	if (entries.length === 0)
		return (
			<p className="hl-hint" style={{ margin: 0 }}>
				No journal entries.
			</p>
		)

	return (
		<div className="hl-stack hl-stack--tight">
			{entries.map(entry => {
				const open = openId === entry.id
				return (
					<div className="hl-stack hl-stack--tight" key={entry.id}>
						<div className="hl-row">
							<span>{entry.title}</span>
							<span className="hl-hint">
								{entry.phase === Phase.DESIGN ? "Design" : "Build"}
								{entry.effectiveDate ? ` · ${entry.effectiveDate}` : ""}
							</span>
							<span className="hl-mono">{entry.hoursClaimed}h claimed</span>
							{entry.hoursApproved === null ? null : <span className="hl-mono">{entry.hoursApproved}h approved</span>}
							{entry.locked ? (
								<Badge tone="warning">in review</Badge>
							) : (
								<Button aria-expanded={open} onClick={() => setOpenId(open ? null : entry.id)} type="button">
									{open ? "Close" : "Correct hours"}
								</Button>
							)}
						</div>
						{open ? <SessionHoursForm entry={entry} /> : null}
					</div>
				)
			})}
		</div>
	)
}

function SessionHoursForm({ entry }: Readonly<{ entry: JournalHoursEntry }>) {
	const [hours, setHours] = useState(String(entry.hoursClaimed))
	const [reason, setReason] = useState("")
	const [saved, setSaved] = useState<string | null>(null)
	const { busy, error, run } = useAction()

	const value = Number(hours)
	const valid =
		hours !== "" && Number.isFinite(value) && value >= 0 && value <= MAX_SESSION_HOURS && value !== entry.hoursClaimed

	function submit(e: React.SubmitEvent) {
		e.preventDefault()
		void run(
			"save",
			() =>
				sendJsonParsed(saveResponseSchema, `/api/admin/sessions/${entry.id}`, {
					body: { hoursClaimed: value, reason },
					method: "PATCH",
				}),
			data =>
				setSaved(
					data.decided
						? "Saved. The week is decided, so its coins and frozen hours did not change. Un-approve and re-review the week to pay the corrected figure."
						: "Saved.",
				),
		)
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{entry.decided ? (
				<Callout tone="warning">
					This week is decided. Saving corrects the record, but the coins and hours it was paid on stay as they are.
				</Callout>
			) : null}
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{saved ? <Callout tone="info">{saved}</Callout> : null}
			<Field hint={`0 to ${MAX_SESSION_HOURS} hours`} label="Claimed hours">
				<TextInput
					max={MAX_SESSION_HOURS}
					min={0}
					onChange={e => setHours(e.target.value)}
					required
					step="any"
					type="number"
					value={hours}
				/>
			</Field>
			<Field hint="Recorded in the audit log with the old and new figures." label="Reason">
				<TextInput maxLength={1000} onChange={e => setReason(e.target.value)} required value={reason} />
			</Field>
			<div>
				<Button disabled={busy !== null || !valid || reason.trim() === ""} type="submit">
					{busy ? "Saving…" : "Save hours"}
				</Button>
			</div>
		</form>
	)
}
