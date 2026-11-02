"use client"

import Link from "next/link"
import type { Dispatch, RefObject, SetStateAction } from "react"
import { Gato } from "@/components/platform/art"
import { IconEye, IconUpload } from "@/components/platform/icons"
import { Markdown } from "@/components/platform/Markdown"
import { Button, borderedInputClass, Field } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import type { LapseTimelapse } from "@/lib/lapse-timelapses"
import { fmtHours } from "@/lib/numbers"
import { EXAMPLE_JOURNAL_URL } from "@/lib/routes"
import { MAX_SESSION_CONTENT } from "@/lib/schemas/session"
import type { Project, SessionLog, Week } from "@/lib/types"
import { IMAGE_ACCEPT } from "@/lib/uploads/image-accept"
import type { JournalImages } from "./journal-images"
import { fmtDuration, LapsePicker } from "./LapsePicker"
import { ModalTitle } from "./Modal"

export type JournalTab = "journal" | "timelapse"

/** The journal/timelapse switch, and the offer to combine the two under it. */
export function JournalTabSwitcher({
	attachedCount,
	setTab,
	tab,
}: {
	attachedCount: number
	setTab: Dispatch<SetStateAction<JournalTab>>
	tab: JournalTab
}) {
	return (
		<>
			{/* An edit re-opens both tabs: the picker comes back with this entry's clips selected, ready to swap. */}
			<div className="mb-5 flex justify-center">
				<div className="sketch flex gap-1 rounded-full bg-white p-1" style={{ "--sk-radius": "999px" }}>
					{(["journal", "timelapse"] as const).map(t => (
						<button
							aria-pressed={tab === t}
							className={cx(
								"label rounded-full px-4 py-1.5 transition-colors",
								tab === t ? "bg-navy text-white" : "text-navy-soft hover:text-navy",
							)}
							key={t}
							onClick={() => setTab(t)}
							type="button"
						>
							{t}
						</button>
					))}
				</div>
			</div>

			{/* Timelapses are picked on the other tab but belong to this entry too: say so under the switcher, so combining the two is an offer on screen rather than something you find by accident. */}
			{tab === "journal" && (
				<p className="hand -mt-2 mb-5 text-center text-[0.78rem] text-navy-soft">
					{attachedCount > 0 ? (
						<>
							{attachedCount === 1 ? "1 timelapse" : `${attachedCount} timelapses`} attached.{" "}
							<button
								className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
								onClick={() => setTab("timelapse")}
								type="button"
							>
								Change them on the timelapse tab
							</button>
							.
						</>
					) : (
						<>
							Writing, filming, or both:{" "}
							<button
								className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
								onClick={() => setTab("timelapse")}
								type="button"
							>
								attach a timelapse too
							</button>{" "}
							if you recorded one.
						</>
					)}
				</p>
			)}
		</>
	)
}

/** The written half of the sheet: hours, the entry itself, and its preview. */
export function JournalEntryTab({
	addJournalImages,
	body,
	claimed,
	coveredSeconds,
	discardDraft,
	draftRestored,
	dragHandlers,
	dragging,
	editing,
	entry,
	hasUnsavedWork,
	hoursText,
	imageError,
	imageInput,
	lapseHours,
	legacyBump,
	longEnough,
	needPhotos,
	overCap,
	picked,
	preview,
	project,
	setBody,
	setHoursText,
	setPreview,
	shots,
	typed,
	uploading,
	week,
	written,
}: {
	addJournalImages: JournalImages["addJournalImages"]
	body: string
	claimed: number
	coveredSeconds: number
	discardDraft(): void
	draftRestored: boolean
	dragHandlers: JournalImages["dragHandlers"]
	dragging: boolean
	editing: boolean
	entry: JournalImages["entry"]
	hasUnsavedWork: boolean
	hoursText: string
	imageError: string | null
	imageInput: RefObject<HTMLInputElement | null>
	lapseHours: number
	legacyBump: { from: number; lapse: number } | null
	longEnough: boolean
	needPhotos: number
	overCap: boolean
	picked: LapseTimelapse[]
	preview: boolean
	project: Project | undefined
	setBody: Dispatch<SetStateAction<string>>
	setHoursText: Dispatch<SetStateAction<string>>
	setPreview: Dispatch<SetStateAction<boolean>>
	shots: number
	typed: number
	uploading: number
	week: Week
	written: number
}) {
	return (
		// The whole sheet takes a drop, not just the box: a picture let go an inch off the textarea would otherwise open in the tab and take the unsaved entry with it.
		<div {...dragHandlers}>
			{editing ? (
				<ModalTitle subWide>Edit this entry</ModalTitle>
			) : (
				// `subWide`: the modal is the large size and the editor below runs its full width, so a subtitle held to 62ch stopped two-thirds of the way across and wrapped into a ragged column.
				<ModalTitle
					sub="Write about the progress you made this work session, complete with pictures/screenshots. Be detailed! Markdown works, images included."
					subWide
				>
					What did you do this session?
				</ModalTitle>
			)}

			<div className="mb-4 max-w-55">
				<Field
					hint={
						picked.length > 0
							? "On top of your timelapses. Put 0 if the recording covers it all."
							: "(9.5 is 9 and a half hours)"
					}
					id="journal-hours"
					label={picked.length > 0 ? "Additional hours" : "Hours this session"}
				>
					<input
						aria-invalid={overCap || undefined}
						className={cx(borderedInputClass, "tabular-nums")}
						id="journal-hours"
						inputMode="decimal"
						onChange={e => setHoursText(e.target.value.replaceAll(/[^\d.]/g, ""))}
						placeholder="0"
						value={hoursText}
					/>
				</Field>
				{/* The claim as the server will log it: what was typed plus what the timelapses recorded. */}
				{lapseHours > 0 && (
					<p className="hand mt-1.5 text-[0.76rem] tabular-nums text-navy-soft" role="status">
						{fmtDuration(coveredSeconds)} from timelapses
						{typed > 0 ? ` + ${fmtDuration(typed * 3600)} declared` : ""} = {fmtDuration(claimed * 3600)} logged
					</p>
				)}
				{editing && legacyBump && (
					<p className="hand mt-1.5 text-[0.76rem] leading-snug text-coral-deep" role="note">
						This entry was logged as {fmtHours(legacyBump.from)} before timelapses added hours on top. With its{" "}
						{fmtHours(legacyBump.lapse)} of recording it now totals {fmtHours(claimed)}. Unpick timelapses on the
						Timelapse tab to bring it back down.
					</p>
				)}
			</div>

			<div className="mb-3 flex flex-wrap items-center gap-2.5">
				<span className="label text-navy-soft">Project:</span>
				<span className="label inline-flex items-center gap-1.5 rounded-full bg-orange px-3 py-1.5 text-navy">
					{project?.name ?? `${week.theme} project`}
				</span>
				<span className="hand ml-auto flex flex-wrap gap-x-3 text-[0.78rem] text-navy-soft">
					<a
						className="underline decoration-dashed underline-offset-4 hover:text-navy"
						href={EXAMPLE_JOURNAL_URL}
						rel="noopener noreferrer"
						target="_blank"
					>
						See an example journal
					</a>
					<Link className="underline decoration-dashed underline-offset-4 hover:text-navy" href="/docs/journalling">
						Unsure? Read our docs
					</Link>
				</span>
			</div>

			{/* Write and read sit side by side rather than behind a swap, so a long entry can be checked against its own formatting without losing the cursor. Below md there is only room for one, and the toggle picks which. */}
			<div className="mb-2 flex items-center justify-between gap-3">
				<p className="label text-violet-deep">
					Your entry{" "}
					{hasUnsavedWork && (
						<span className="hand ml-1 font-normal normal-case text-navy-soft" role="status">
							· {draftRestored ? "draft restored, autosaves as you type" : "draft autosaved"}
						</span>
					)}
				</p>
				<span className="flex items-center gap-2">
					{hasUnsavedWork && (
						<button
							className="label rounded-full px-3 py-1.5 text-navy-soft underline decoration-dashed underline-offset-4 hover:text-coral-deep"
							onClick={discardDraft}
							type="button"
						>
							Discard draft
						</button>
					)}
					<button
						aria-pressed={preview}
						className={cx(
							"label inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 transition-colors",
							preview
								? "border-violet bg-violet-pale text-violet-deep"
								: "border-line text-navy-soft hover:border-violet hover:text-navy",
						)}
						onClick={() => setPreview(v => !v)}
						type="button"
					>
						<IconEye className="text-base" /> {preview ? "Hide preview" : "Preview"}
					</button>
				</span>
			</div>

			<div className={cx("grid gap-3", preview && "md:grid-cols-2")}>
				{/* `min-w-0` on both columns: a grid item is otherwise as wide as its widest unbroken content, so a long URL in the entry widened the column and the preview beside it scrolled sideways. */}
				<div className={cx("relative min-w-0", preview && "hidden md:block")}>
					<Gato
						className="pointer-events-none absolute top-1/2 left-1/2 h-auto w-40 -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
						sizes="160px"
					/>
					<textarea
						aria-label="Journal entry"
						className={cx(
							borderedInputClass,
							"relative h-full resize-none",
							dragging && "border-violet! bg-violet-pale/60",
						)}
						// The server refuses a longer entry, so the box stops at the same number rather than letting the writing be done and the save refused afterwards.
						maxLength={MAX_SESSION_CONTENT}
						onChange={e => setBody(e.target.value)}
						onPaste={e => {
							// A screenshot on the clipboard goes up like a dropped one; pasted text is left to the textarea.
							const pasted = Array.from(e.clipboardData.files).filter(f => f.type.startsWith("image/"))
							if (pasted.length === 0) return
							e.preventDefault()
							void addJournalImages(pasted)
						}}
						placeholder="Start typing… What did you work on? What worked and what didn't? &#10;&#10; Markdown styling enabled! Drag, drop or paste images straight in."
						ref={entry}
						rows={9}
						value={body}
					/>
					{dragging && (
						<p className="hand pointer-events-none absolute inset-0 grid place-items-center text-[0.95rem] text-violet-deep">
							drop images to add them to your entry
						</p>
					)}
				</div>

				{preview && (
					<div
						className="sketch thin-scroll max-h-60 min-h-32 min-w-0 overflow-y-auto rounded-xl bg-white px-4 py-3 md:max-h-none"
						style={{ "--sk-color": "var(--color-violet)", "--sk-radius": "12px" }}
					>
						{body.trim() ? (
							<Markdown className="grid gap-2.5 text-[0.9rem] leading-relaxed text-navy" source={body} />
						) : (
							<p className="hand text-[0.85rem] text-navy-soft">
								nothing to preview yet. headings, **bold**, lists, `code` and ![images](url) all work.
							</p>
						)}
					</div>
				)}
			</div>

			<p className="hand mt-2 text-[0.78rem] leading-snug text-navy-soft">
				Reviewers approve your hours and funding from these entries, so make the description thorough: say what you
				built, what broke, and what&apos;s next, with lots of screenshots and photos where you can.
			</p>
			<div className="mt-2 flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
				<p className={cx("hand text-[0.76rem] tabular-nums", shots >= needPhotos ? "text-teal-ink" : "text-navy-soft")}>
					{shots} / {needPhotos} images
				</p>
				<Button
					aria-label="Add images to your journal entry"
					disabled={uploading > 0}
					onClick={() => imageInput.current?.click()}
					size="sm"
					variant="outline"
				>
					<IconUpload className="text-base" />
					{uploading > 0 ? "Uploading…" : "Add images"}
				</Button>
				<input
					accept={IMAGE_ACCEPT}
					aria-hidden="true"
					className="sr-only"
					multiple
					onChange={event => {
						// Copied out first: clearing the input empties the live list.
						const files = Array.from(event.target.files ?? [])
						event.target.value = ""
						void addJournalImages(files)
					}}
					ref={imageInput}
					tabIndex={-1}
					type="file"
				/>
				<p className={cx("hand text-[0.76rem] tabular-nums", longEnough ? "text-teal-ink" : "text-navy-soft")}>
					{written} / 200 characters
				</p>
			</div>
			{imageError ? (
				<p className="mt-2 text-right text-[0.8rem] font-semibold text-coral-deep" role="alert">
					{imageError}
				</p>
			) : null}
		</div>
	)
}

/** The filmed half: the Lapse picker, and the older clips an edit keeps by id. */
export function JournalTimelapseTab({
	claimed,
	clipsTouchedRef,
	coveredSeconds,
	editing,
	existing,
	legacyKept,
	picked,
	pinned,
	setPicked,
	setPinned,
	signInWithLapse,
}: {
	claimed: number
	clipsTouchedRef: { current: boolean }
	coveredSeconds: number
	editing: boolean
	existing: SessionLog | undefined
	legacyKept: string[]
	picked: LapseTimelapse[]
	pinned: string[]
	setPicked: Dispatch<SetStateAction<LapseTimelapse[]>>
	setPinned: Dispatch<SetStateAction<string[]>>
	signInWithLapse(): void
}) {
	return (
		<div>
			<ModalTitle
				sub="Record timelapse(s) on Lapse, publish as unlisted or public, then select it here. It won't show up if the timelapses are listed as private. Make sure you're pausing your timelapse when you're not working on your project! Timelapses can back the entry on their own, or together with a written entry. Pick here, write on the journal tab."
				subWide
			>
				Select your timelapses
			</ModalTitle>

			{editing && (pinned.length > 0 || legacyKept.length > 0) && (
				<div className="mb-3 grid justify-items-center gap-1.5">
					{/* Clips Lapse would not re-verify stay by id: listed so they can still be taken off, rather than stuck on forever. */}
					{pinned.map(id => (
						<p
							className="hand flex flex-wrap items-center justify-center gap-x-2 text-center text-[0.78rem] text-navy-soft"
							key={id}
						>
							<span>Kept from the original entry.</span>
							<button
								className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
								onClick={() => {
									clipsTouchedRef.current = true
									setPinned(prev => prev.filter(x => x !== id))
								}}
								type="button"
							>
								Remove
							</button>
						</p>
					))}
					{legacyKept.length > 0 && (
						<p className="hand text-center text-[0.78rem] text-navy-soft">
							{legacyKept.length === 1 ? "1 older recording" : `${legacyKept.length} older recordings`} kept from the
							original entry.
						</p>
					)}
				</div>
			)}
			<LapsePicker
				forSession={editing ? existing?.id : undefined}
				onSignIn={signInWithLapse}
				onToggle={t => {
					clipsTouchedRef.current = true
					setPicked(p => (p.some(x => x.id === t.id) ? p.filter(x => x.id !== t.id) : [...p, t]))
				}}
				picked={picked}
			/>

			<p className="mt-4 text-center text-[0.82rem] text-navy-soft tabular-nums">
				{picked.length === 0
					? " "
					: `${picked.length === 1 ? "1 timelapse" : `${picked.length} timelapses`} picked · ${fmtDuration(coveredSeconds)} recorded${
							claimed > 0 ? `, logged as ${fmtHours(claimed)}` : ""
						}`}
			</p>
		</div>
	)
}
