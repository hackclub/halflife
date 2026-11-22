"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { addReviewNote, removeReviewNote } from "@/components/review/api"
import { useDraft, useStoredToggle } from "@/components/review/hooks"
import { useReviewRuntime } from "@/components/review/runtime"
import { FormErrors, Paper, StatusTag } from "@/components/review/ui"
import type { ReviewDetail, ReviewNote, ReviewViewer } from "@/lib/review-platform/types"

type View = "flag" | "note" | null
type Subject = "ship" | "project" | "maker"

const SUBJECTS: readonly (readonly [Subject, string])[] = Object.freeze([
	["ship", "On this ship"],
	["project", "On the project"],
	["maker", "On the maker"],
])

const SUBJECT_NAMES: { [_ in ReviewNote["subject"]]: string } = Object.freeze({
	"earlier-ship": "an earlier ship",
	maker: "the maker",
	project: "the project",
	ship: "this ship",
})

/** This ship's notes, which a decision sends as its internal note: the reason a rejection needs, and Airtable's `Justification - Additional Justification`. */
export const shipNoteText = (notes: ReviewNote[]): string =>
	notes
		.filter(note => note.subject === "ship" && !note.flag)
		.map(note => note.body)
		.join("\n\n")

/**
 * Fabricate's "Flags & notes": what reviewers leave each other about a ship, its project or its maker, and the project's flag, which shows in the queue. Never shown to the maker.
 *
 * Notes on this ship are also the decision's internal note (see `shipNoteText`). A decision made before that has its own internal note, shown here when the ship has no notes of its own.
 */
export function ReviewNotes({ detail, viewer }: { detail: ReviewDetail; viewer: ReviewViewer }) {
	const runtime = useReviewRuntime()
	const { ship } = detail
	const dialog = useRef<HTMLDialogElement>(null)
	const [view, setView] = useState<View>(null)
	const [body, setBody, clearBody] = useDraft(`submission:${ship.id}:note`)
	const [flagReason, setFlagReason, clearFlagReason] = useDraft(`submission:${ship.id}:flag`)
	const [subject, setSubject] = useState<Subject>("ship")
	const [errors, setErrors] = useState<string[]>([])
	const [busy, setBusy] = useState(false)
	const [shown, setShown] = useStoredToggle("halflife:review-notes")
	const { confirm, dialog: confirmDialog } = useConfirm()

	const flag = detail.notes.find(note => note.flag) ?? null
	const notes = detail.notes.filter(note => !note.flag)
	const decisionReason = ship.decision?.reason && shipNoteText(notes) === "" ? ship.decision : null
	const count = notes.length + (flag ? 1 : 0) + (decisionReason ? 1 : 0)
	const collapsed = !shown && count > 0
	const close = (): void => setView(null)

	useEffect(() => {
		const el = dialog.current
		if (!el) return
		if (view && !el.open) el.showModal()
		if (!view && el.open) el.close()
	}, [view])

	async function run(task: () => Promise<unknown>, done?: () => void): Promise<void> {
		setErrors([])
		setBusy(true)
		try {
			await task()
			done?.()
			runtime.refresh()
		} catch (err) {
			setErrors([err instanceof Error ? err.message : "Couldn't save this note"])
		} finally {
			setBusy(false)
		}
	}

	function submit(e: React.SubmitEvent): void {
		e.preventDefault()
		const flagging = view === "flag"
		void run(
			() =>
				addReviewNote({
					body: (flagging ? flagReason : body).trim(),
					flag: flagging,
					subject: flagging ? "project" : subject,
					submissionId: ship.id,
				}),
			() => {
				if (flagging) clearFlagReason()
				else clearBody()
				close()
			},
		)
	}

	async function remove(note: ReviewNote): Promise<void> {
		const ok = await confirm({
			confirmLabel: note.flag ? "Clear flag" : "Remove",
			message: note.flag ? "The project stops showing as flagged in the queue." : "Other reviewers stop seeing it.",
			title: note.flag ? "Clear the flag on this project?" : "Remove this note?",
			tone: "danger",
		})
		if (ok === null) return
		void run(() => removeReviewNote(note.id))
	}

	const removable = (note: ReviewNote): boolean =>
		!runtime.offline && (note.authorId === viewer.id || (note.flag ? viewer.canOverride : viewer.isAdmin))

	return (
		<Paper
			actions={
				count > 0 ? (
					<button
						aria-controls={`review-notes-${ship.id}`}
						aria-expanded={!collapsed}
						aria-label={collapsed ? `Show flags and notes (${count})` : "Hide flags and notes"}
						className="btn btn--ghost btn--sm notes-toggle"
						onClick={() => setShown(collapsed)}
						type="button"
					>
						<span aria-hidden={!collapsed}>Show ({count})</span>
						<span aria-hidden={collapsed}>Hide</span>
					</button>
				) : null
			}
			className={collapsed || count === 0 ? "notes-card--collapsed" : undefined}
			meta="Internal. Never shown to the maker."
			title="Flags & notes"
		>
			{confirmDialog}
			{view === null ? <FormErrors errors={errors} /> : null}
			{count === 0 ? (
				<p className="field__hint">No flags or notes yet.</p>
			) : collapsed ? null : (
				<ul className="notes-list" id={`review-notes-${ship.id}`}>
					{flag ? (
						<li>
							<p className="entry__date">
								<StatusTag status="flagged" /> Flagged on the project by {flag.author} · {flag.at}
								{removable(flag) ? (
									<>
										{" · "}
										<button className="notes-list__action" onClick={() => void remove(flag)} type="button">
											clear
										</button>
									</>
								) : null}
							</p>
							<ClampedText text={flag.body} />
						</li>
					) : null}
					{decisionReason ? (
						<li>
							<p className="entry__date">
								Internal note with the decision by {decisionReason.reviewerName} · {decisionReason.reviewedAt}
							</p>
							<ClampedText text={decisionReason.reason ?? ""} />
						</li>
					) : null}
					{notes.map(note => (
						<li key={note.id}>
							<p className="entry__date">
								Note on {SUBJECT_NAMES[note.subject]} by {note.author} · {note.at}
								{removable(note) ? (
									<>
										{" · "}
										<button className="notes-list__action" onClick={() => void remove(note)} type="button">
											remove
										</button>
									</>
								) : null}
							</p>
							<ClampedText text={note.body} />
						</li>
					))}
				</ul>
			)}
			{collapsed || runtime.offline ? null : (
				<div className="form__actions notes-form">
					{flag ? null : (
						<button className="btn btn--ghost btn--sm" onClick={() => setView("flag")} type="button">
							Flag project
						</button>
					)}
					<button className="btn btn--ghost btn--sm" onClick={() => setView("note")} type="button">
						Add note
					</button>
				</div>
			)}

			<dialog
				className="modal notes-modal"
				onCancel={e => {
					e.preventDefault()
					close()
				}}
				ref={dialog}
			>
				{view === null ? null : (
					<form onSubmit={submit}>
						<h2 className="modal__title">{view === "flag" ? "Flag project" : "Add note"}</h2>
						{view === "flag" ? (
							<p className="modal__body">Shows in the review queue.</p>
						) : (
							<select
								aria-label="Note about"
								className="field__select"
								onChange={e => setSubject(SUBJECTS.find(([id]) => id === e.target.value)?.[0] ?? "ship")}
								value={subject}
							>
								{SUBJECTS.map(([id, label]) => (
									<option key={id} value={id}>
										{label}
									</option>
								))}
							</select>
						)}
						<FormErrors errors={errors} />
						<textarea
							aria-label={view === "flag" ? "Flag reason" : "Note"}
							autoFocus
							className="field__textarea"
							onChange={e => (view === "flag" ? setFlagReason(e.target.value) : setBody(e.target.value))}
							placeholder={
								view === "flag"
									? "What looks off about this project?"
									: subject === "ship"
										? "Add a note for other reviewers. Notes on this ship are sent as the decision's internal note."
										: "Add a note for other reviewers"
							}
							value={view === "flag" ? flagReason : body}
						/>
						<div className="form__actions form__actions--end">
							<button className="btn btn--ghost" onClick={close} type="button">
								Cancel
							</button>
							<button
								className="btn btn--ink"
								disabled={busy || !(view === "flag" ? flagReason : body).trim()}
								type="submit"
							>
								{view === "flag" ? "Flag project" : "Add note"}
							</button>
						</div>
					</form>
				)}
			</dialog>
		</Paper>
	)
}

/** Fabricate's four-line clamp, with "Show more" only when the text runs past it. */
function ClampedText({ text }: { text: string }) {
	const ref = useRef<HTMLParagraphElement>(null)
	const [open, setOpen] = useState(false)
	const [overflows, setOverflows] = useState(false)

	useLayoutEffect(() => {
		const el = ref.current
		if (!el || open) return
		const measure = (): void => setOverflows(el.scrollHeight > el.clientHeight + 1)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [open])

	return (
		<>
			<p className={open ? "notes-list__text" : "notes-list__text notes-list__text--clamped"} ref={ref}>
				{text}
			</p>
			{overflows || open ? (
				<button aria-expanded={open} className="notes-list__action" onClick={() => setOpen(!open)} type="button">
					{open ? "Show less" : "Show more"}
				</button>
			) : null}
		</>
	)
}
