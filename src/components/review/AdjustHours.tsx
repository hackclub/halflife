"use client"

import { useState } from "react"
import { formatHours } from "@/components/review/format"
import { JournalEntryView } from "@/components/review/JournalEntryView"
import { useReviewRuntime } from "@/components/review/runtime"
import { useReviewConfirm } from "@/components/review/useReviewConfirm"
import type { ReviewEntry } from "@/lib/review-platform/types"

interface Edit {
	minutes: string
	note: string
}

const savedMinutes = (entry: ReviewEntry): string =>
	entry.approvedSeconds === null ? "" : String(Math.round(entry.approvedSeconds / 60))

const changed = (entry: ReviewEntry, edit: Edit | undefined): edit is Edit =>
	edit !== undefined && (edit.minutes !== savedMinutes(entry) || edit.note !== (entry.reviewerNote ?? ""))

/**
 * The journal of the viewer's own standing approval, with each entry's deflation editable and one button that re-pays the approval at the new total (see `adjustApprovedHours`).
 *
 * Unlike the pending screen's autosave, nothing is written until the reviewer re-pays: every write here moves the maker's coins and writes a ledger row they can see, so it happens once, for the whole change.
 */
export function AdjustableJournal({
	approvedHours,
	entries,
	shipId,
}: {
	approvedHours: number | null
	entries: readonly ReviewEntry[]
	shipId: string
}) {
	const runtime = useReviewRuntime()
	const { confirm, dialog } = useReviewConfirm()
	const [edits, setEdits] = useState<{ [_: string]: Edit }>({})
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)

	const pending = entries.filter(entry => changed(entry, edits[entry.id]))
	const invalid = pending.some(entry => {
		const minutes = edits[entry.id]?.minutes ?? ""
		return minutes !== "" && !(Number(minutes) >= 0)
	})

	async function repay(): Promise<void> {
		const sure = await confirm({
			confirmLabel: "Re-pay",
			message:
				"The approval stays and the maker isn't messaged. Their coins for it are reconciled to the new total, and the unified justification is written again from the new hours, replacing any hand edits to it.",
			title: `Re-pay this approval with ${pending.length} ${pending.length === 1 ? "entry" : "entries"} changed?`,
		})
		// Null on cancel; confirming with no input field gives the empty string.
		if (sure === null) return
		setBusy(true)
		setMessage(null)
		try {
			const outcome = await runtime.adjustHours(
				shipId,
				pending.map(entry => {
					const edit = edits[entry.id] ?? { minutes: "", note: "" }
					// An empty box counts what was claimed, as on the pending screen.
					const minutes = edit.minutes === "" ? entry.secondsSpent / 60 : Number(edit.minutes)
					return { comments: edit.note, hoursApproved: Math.round((minutes / 60) * 1000) / 1000, id: entry.id }
				}),
			)
			setEdits({})
			setMessage({
				error: false,
				text: `Re-paid at ${formatHours(outcome.approvedHours)}.${outcome.unrecovered > 0 ? ` ${outcome.unrecovered} coins were already spent and couldn't be taken back.` : ""}`,
			})
			runtime.refresh()
		} catch (err) {
			setMessage({ error: true, text: err instanceof Error ? err.message : "Couldn't re-pay this approval" })
		} finally {
			setBusy(false)
		}
	}

	return (
		<>
			{dialog}
			<div className="form__actions">
				<span className="field__hint">
					Approved at {approvedHours === null ? "—" : formatHours(approvedHours)}. Change what entries count as, then
					re-pay the approval.
				</span>
				<button
					className="btn btn--sm"
					disabled={busy || invalid || pending.length === 0}
					onClick={() => void repay()}
					type="button"
				>
					Re-pay at new hours
				</button>
				{message ? (
					<span className={message.error ? "field__error" : "field__hint"} role={message.error ? "alert" : "status"}>
						{message.text}
					</span>
				) : null}
			</div>
			<div className="timeline">
				{entries.map(entry => {
					const edit = edits[entry.id] ?? { minutes: savedMinutes(entry), note: entry.reviewerNote ?? "" }
					const set = (next: Partial<Edit>): void => setEdits(all => ({ ...all, [entry.id]: { ...edit, ...next } }))
					return (
						<JournalEntryView
							entry={entry}
							key={entry.id}
							reviewer={
								entry.countsHours ? (
									<fieldset className="review-lock" disabled={busy}>
										<div className="entry-review">
											<div className="form__actions">
												<label className="field__label" htmlFor={`adjust-${entry.id}`}>
													Count as (minutes)
												</label>
												<input
													className="field__input"
													id={`adjust-${entry.id}`}
													min={0}
													onChange={e => set({ minutes: e.target.value })}
													placeholder={String(Math.round(entry.secondsSpent / 60))}
													style={{ width: "7rem" }}
													type="number"
													value={edit.minutes}
												/>
												<span className="field__hint">
													{Math.round(entry.secondsSpent / 60)} min reported
													{changed(entry, edits[entry.id]) ? " · changed" : ""}
												</span>
											</div>
											<div className="form__actions">
												<input
													aria-label="Deflation note"
													className="field__input"
													onChange={e => set({ note: e.target.value })}
													placeholder="Why deflated (staff only, and quoted in the unified justification)"
													style={{ flex: "1 1 14rem" }}
													value={edit.note}
												/>
											</div>
										</div>
									</fieldset>
								) : undefined
							}
						/>
					)
				})}
				{entries.length === 0 ? <p className="field__hint">No journal entries for this phase.</p> : null}
			</div>
		</>
	)
}
