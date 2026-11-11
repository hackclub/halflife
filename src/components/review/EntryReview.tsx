"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { saveSessionHours } from "@/components/review/api"
import { formatDuration } from "@/components/review/format"
import { useAutosave } from "@/components/review/hooks"
import type { ReviewEntry } from "@/lib/review-platform/types"

export type EntrySave = "saving" | "error" | null

/**
 * Fabricate's per-entry deflation: "count as N minutes" and a staff-only note, autosaved.
 *
 * Saved through `/api/review/hours`, the route the console uses, so the same rules apply – the phase must be in review, another reviewer's live claim refuses the write, and nobody approves hours on their own work. The route stores hours, so the minutes are converted on the way out and back.
 */
export function EntryReview({ entry, onSaving }: { entry: ReviewEntry; onSaving(id: string, state: EntrySave): void }) {
	const router = useRouter()
	const savedMinutes = entry.approvedSeconds === null ? "" : String(Math.round(entry.approvedSeconds / 60))
	const [approved, setApproved] = useState(savedMinutes)
	const [note, setNote] = useState(entry.reviewerNote ?? "")
	const [badMinutes, setBadMinutes] = useState(false)
	const { change, flush, status } = useAutosave(async (value: { approved: string; note: string }, keepalive) => {
		// An empty box means "count what was claimed" – the console has no way to clear an approval, so it saves the claim itself.
		const minutes = value.approved === "" ? entry.secondsSpent / 60 : Number(value.approved)
		if (!Number.isFinite(minutes) || minutes < 0) throw new Error("Minutes must be 0 or more")
		await saveSessionHours(
			{ comments: value.note, hoursApproved: Math.round((minutes / 60) * 1000) / 1000, id: entry.id },
			keepalive,
		)
		router.refresh()
	})
	const reverted = !badMinutes && approved === savedMinutes && note === (entry.reviewerNote ?? "")
	const saving: EntrySave =
		typeof status === "object" && status !== null && !reverted ? "error" : status === "saving" ? "saving" : null

	useEffect(() => {
		onSaving(entry.id, saving)
		return () => onSaving(entry.id, null)
	}, [entry.id, saving, onSaving])

	return (
		<div className="entry-review">
			<div className="form__actions">
				<label className="field__label" htmlFor={`approved-${entry.id}`}>
					Count as (minutes)
				</label>
				<input
					className="field__input"
					id={`approved-${entry.id}`}
					min={0}
					onBlur={() => flush()}
					onChange={e => {
						setApproved(e.target.value)
						setBadMinutes(e.target.validity.badInput)
						change({ approved: e.target.validity.badInput ? "invalid" : e.target.value, note })
					}}
					placeholder={String(Math.round(entry.secondsSpent / 60))}
					style={{ width: "7rem" }}
					type="number"
					value={approved}
				/>
				<span className="field__hint">
					{Math.round(entry.secondsSpent / 60)} min reported
					{entry.timelapseSeconds > 0 ? ` · ${formatDuration(entry.timelapseSeconds)} recorded` : ""}
				</span>
				{status && typeof status === "object" ? (
					<span className="field__error" role="alert">
						{status.error}
					</span>
				) : (
					<span aria-live="polite" className="field__hint">
						{status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
					</span>
				)}
			</div>
			<div className="form__actions">
				<input
					aria-label="Deflation note"
					className="field__input"
					onBlur={() => flush()}
					onChange={e => {
						setNote(e.target.value)
						change({ approved: badMinutes ? "invalid" : approved, note: e.target.value })
					}}
					placeholder="Why deflated (visible to staff only)"
					style={{ flex: "1 1 14rem" }}
					value={note}
				/>
			</div>
		</div>
	)
}
