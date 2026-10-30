"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Gato } from "@/components/platform/art"
import { IconArrowRight, IconCheck, IconClock, IconEye, IconUpload, IconWarning } from "@/components/platform/icons"
import { Markdown } from "@/components/platform/Markdown"
import { Button, borderedInputClass, Field } from "@/components/platform/ui"
import { linkLapse } from "@/lib/auth-client"
import { COINS_PER_HOUR } from "@/lib/config/printers"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { photosRequired } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { ParticipantGoal } from "@/lib/enums"
import type { LapseTimelapse } from "@/lib/lapse-timelapses"
import { countImages, proseLength } from "@/lib/markdown"
import { round2 } from "@/lib/money"
import { fmtHours } from "@/lib/numbers"
import { EXAMPLE_JOURNAL_URL } from "@/lib/routes"
import { MAX_SESSION_CONTENT, MAX_SESSION_HOURS } from "@/lib/schemas/session"
import { useStore } from "@/lib/store"
import type { Checkpoint, Week } from "@/lib/types"
import { IMAGE_ACCEPT } from "@/lib/uploads/image-accept"
import {
	altFor,
	clampToContentLimit,
	cleanBodyForAutosave,
	clearJournalAutosave,
	draftKey,
	droppedImages,
	type ImageSource,
	isWeeksProject,
	LapseResolveBodySchema,
	peekJournalTrip,
	readJournalAutosave,
	stashJournalDraft,
	storeImage,
	weekName,
	withoutPlaceholder,
	writeJournalAutosave,
} from "./checkpoint-shared"
import { fmtDuration, LapsePicker } from "./LapsePicker"
import { Modal, ModalTitle } from "./Modal"

/** The journal sheet's footer: why the button is greyed, or what saving will do, and the save itself. */
function JournalFooter({
	chasingPrinter,
	editing,
	missing,
	ok,
	save,
	saveError,
	saving,
	showGoal,
	toFloor,
	toGoal,
	uploading,
	week,
	weeklyGoalCoins,
}: {
	chasingPrinter: boolean
	editing: boolean
	missing: string | null
	ok: boolean
	save(): void
	saveError: string | null
	saving: boolean
	showGoal: boolean
	toFloor: number
	toGoal: number
	uploading: number
	week: Week
	weeklyGoalCoins: number
}) {
	return (
		<>
			<div className="mr-auto flex min-w-[min(100%,16rem)] flex-1 items-center gap-3">
				{missing || saveError ? (
					<IconWarning className="shrink-0 text-lg text-coral" />
				) : (
					<IconClock className="shrink-0 text-lg text-navy-soft" />
				)}
				<p
					className={cx(
						"hand min-w-0 flex-1 text-[0.76rem] leading-snug",
						missing || saveError ? "text-coral-deep" : "text-navy-soft",
					)}
					role={saveError ? "alert" : undefined}
				>
					{saveError ? (
						saveError
					) : uploading > 0 ? (
						`Uploading ${uploading === 1 ? "an image" : `${uploading} images`}…`
					) : missing ? (
						missing
					) : editing ? (
						"Saving replaces this entry. It keeps its place on the map."
					) : toFloor > 0 ? (
						<>
							{fmtHours(toFloor)} more before you can {week.id === WARMUP_WEEK_ID ? "submit it" : "wrap up the week"}
							{showGoal ? (
								<>
									, and {fmtHours(toGoal)} more if you want to reach your goal of{" "}
									<strong className="rounded bg-gold-pale px-1 text-gold-ink">{weeklyGoalCoins} coins</strong> per week.
								</>
							) : !chasingPrinter ? (
								<>
									. Every hour past the minimum earns{" "}
									<strong className="rounded bg-gold-pale px-1 text-gold-ink">5 coins</strong> per hour.
								</>
							) : (
								"."
							)}
						</>
					) : (
						"Submit your project when it's done!"
					)}
				</p>
			</div>

			<Button disabled={!ok || saving || uploading > 0} onClick={() => save()} variant="solid">
				{saving ? "Saving…" : editing ? "Save changes" : "Finish"}{" "}
				{editing ? <IconCheck className="text-base" /> : <IconArrowRight className="text-base" />}
			</Button>
		</>
	)
}

export function JournalModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const {
		setOpenCheckpoint,
		logSession,
		editSession,
		complete,
		projects,
		stateOf,
		weekOfCheckpoint,
		hoursOf,
		participantGoal,
	} = useStore()

	const week = weekOfCheckpoint(checkpoint)

	// Every journal node is one entry: write it and it is done. The week's clock is what decides whether wrapping up is on the table yet. Opened again once it is done, the same sheet is that entry, to correct – not a new one.
	// oxlint-disable-next-line react/hook-use-state
	const [existing] = useState(() => {
		const saved = stateOf(checkpoint.id)
		return saved.done ? saved.log[0] : undefined
	})
	const editing = existing !== undefined

	// A Lapse sign-in leaves the page and comes back: that trip's draft is restored once. Anything else typed is autosaved to this browser and restored next time the sheet opens, so clicking out cannot lose it. A saved entry clears it. Peeked (not taken) during render so StrictMode's double-invoked initializer cannot consume it before state is set.
	// oxlint-disable-next-line react/hook-use-state
	const [draft] = useState(() => peekJournalTrip(checkpoint.id) ?? readJournalAutosave(checkpoint.id))
	const draftRestored = draft != null

	// An edit re-opens the picker with this entry's clips selected: Lapse clips that still verify resolve into items, ones Lapse no longer vouches for stay pinned by id, and older non-Lapse uploads stay untouched. The resolve below seeds all three; a returning draft already holds the working set.
	const [picked, setPicked] = useState<LapseTimelapse[]>(draft?.picked ?? [])
	const [pinned, setPinned] = useState<string[]>(draft?.pinned ?? [])
	const [legacyKept, setLegacyKept] = useState<string[]>(draft?.legacy ?? [])
	// The last-saved clip set, for telling a real change from the seed – and for putting the seed back on "Discard draft".
	const [clipSeed, setClipSeed] = useState<{ picked: LapseTimelapse[]; pinned: string[] }>({
		picked: [],
		pinned: [],
	})
	// Resolve runs once per open; anything the maker toggles after that wins over the seed, whenever it lands.
	const seededRef = useRef(false)
	const clipsTouchedRef = useRef(
		(draft?.picked.length ?? 0) > 0 || (draft?.pinned?.length ?? 0) > 0 || (draft?.legacy?.length ?? 0) > 0,
	)

	const [tab, setTab] = useState<"journal" | "timelapse">(editing ? "journal" : (draft?.tab ?? "journal"))
	// The Lapse timelapses backing this session (clip state lives above, with the seed it resolves from). A draft is cut to the box's own ceiling: autosave wrote whatever was typed, including entries past a limit the server refuses, so a draft from before `maxLength` existed restores to something that can be typed on and saved. The saved entry is not cut, because it came from the server and is already within bounds.
	const [body, setBody] = useState(draft ? clampToContentLimit(draft.body) : (existing?.body ?? ""))
	const [preview, setPreview] = useState(false)
	// Free text, not a number: a controlled number input that coerces as you type eats the decimal point the moment you reach for "1.5".
	const [hoursText, setHoursText] = useState(
		draft?.hoursText ?? (existing ? String(round2(existing.minutes / 60)) : ""),
	)
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const imageInput = useRef<HTMLInputElement>(null)
	const entry = useRef<HTMLTextAreaElement>(null)
	// Images still on their way up. Each one holds a placeholder in the entry until its link comes back, and Finish waits for all of them.
	const [uploading, setUploading] = useState(0)
	const [imageError, setImageError] = useState<string | null>(null)
	// Files being dragged over the sheet. Counted, because every child the drag crosses fires its own enter and leave.
	const [dragging, setDragging] = useState(false)
	const dragDepth = useRef(0)
	const placeholderSeq = useRef(0)

	// Autosave: every keystroke lands in this browser, so closing the sheet, reloading, or navigating away cannot lose it. Empty sheets and edits matching the saved entry keep no draft; a saved entry clears it.
	const baselineBody = existing?.body ?? ""
	// In the box's own arithmetic, once the seed below restates it: the box holds what the timelapses do not cover, so the baseline moves with it.
	const [baselineHours, setBaselineHours] = useState(existing ? String(round2(existing.minutes / 60)) : "")
	// An entry logged under the old arithmetic whose old total does not cover its resolved timelapses: restating the box clamps it at zero and the total grows on open. Named on screen rather than silently absorbed, so a typo fix never quietly logs extra hours.
	const [legacyBump, setLegacyBump] = useState<{ from: number; lapse: number } | null>(null)
	// The trip draft has been restored into state: consume it so it cannot resurrect an entry days later. Autosave below keeps it from here on.
	useEffect(() => {
		try {
			window.sessionStorage.removeItem(draftKey(checkpoint.id))
		} catch {
			// Storage off.
		}
	}, [checkpoint.id])

	// Seed the picker's working set from what the entry was saved with. The seed never overwrites anything already picked – a returning draft, or a toggle that beat the read back, always wins.
	useEffect(() => {
		if (!editing || !existing || existing.clips.length === 0 || seededRef.current) return
		let live = true
		void (async () => {
			let seed: { picked: LapseTimelapse[]; pinned: string[] } = { picked: [], pinned: [] }
			let legacy: string[] = []
			try {
				const query = new URLSearchParams({ forSession: existing.id, ids: existing.clips.join(",") })
				const res = await fetch(`/api/lapse/timelapses/resolve?${query}`, { cache: "no-store" })
				const parsed = LapseResolveBodySchema.safeParse(await res.json().catch(() => null))
				if (!res.ok || !parsed.success) throw new Error("unresolvable")
				const payload = parsed.data
				seed = { picked: payload.resolved ?? [], pinned: payload.pinned ?? [] }
				legacy = payload.legacy ?? []
				// Anything the resolve did not account for stays attached by id. Without this a clip the endpoint declined to read – it reads a bounded number – would fall out of the working set, and saving the edit would take it off the entry for good.
				const accounted = new Set([...seed.picked.map(t => t.id), ...seed.pinned, ...legacy])
				for (const id of existing.clips) if (!accounted.has(id)) seed.pinned.push(id)
			} catch {
				// Lapse unreachable or unlinked: keep every stored ref by id. The server preserves what is already attached, so an edit that touches the words drops nothing.
				seed = { picked: [], pinned: existing.clips }
			}
			if (!live) return
			seededRef.current = true
			setClipSeed(seed)
			setLegacyKept(legacy)
			if (!clipsTouchedRef.current) {
				setPicked(seed.picked)
				setPinned(seed.pinned)
				// The saved figure was logged under the old arithmetic, so restate the box as the part the timelapses do not cover: the total is unchanged unless the maker edits it. The baseline moves with the box – autosave, discard and "matches saved" all compare against it, and leaving it at the old total would restore that total as a residual on discard and count the timelapses twice.
				const seedLapseHours = Math.round((seed.picked.reduce((n, t) => n + t.durationSeconds, 0) / 3600) * 100) / 100
				if (seedLapseHours > 0) {
					const baseHours = round2(existing.minutes / 60)
					const restated = String(Math.max(0, Math.round((baseHours - seedLapseHours) * 100) / 100))
					setHoursText(restated)
					setBaselineHours(restated)
					if (seedLapseHours > baseHours) setLegacyBump({ from: baseHours, lapse: seedLapseHours })
				}
			}
		})()
		return () => {
			live = false
		}
		// `existing` is the entry this sheet opened on: it never changes mid-edit.
	}, [editing, existing, checkpoint.id])
	useEffect(() => {
		const cleanBody = cleanBodyForAutosave(body)
		const hasContent =
			cleanBody.trim() !== ""
			|| hoursText.trim() !== ""
			|| picked.length > 0
			|| pinned.length > 0
			|| (!editing && tab !== "journal")
		// Clips compare as sets against the seed: reordering a pick is not a change.
		const workingIds = [...picked.map(t => t.id), ...pinned].toSorted()
		const seedIds = [...clipSeed.picked.map(t => t.id), ...clipSeed.pinned].toSorted()
		const clipsMatch = workingIds.length === seedIds.length && workingIds.every((id, i) => seedIds[i] === id)
		const matchesSaved = editing && cleanBody === baselineBody && hoursText === baselineHours && clipsMatch
		if (!hasContent || matchesSaved) {
			writeJournalAutosave(checkpoint.id, null)
			return
		}
		writeJournalAutosave(checkpoint.id, { body: cleanBody, hoursText, legacy: legacyKept, picked, pinned, tab })
	}, [checkpoint.id, tab, body, hoursText, picked, pinned, legacyKept, clipSeed, editing, baselineBody, baselineHours])

	const hasUnsavedWork =
		cleanBodyForAutosave(body).trim() !== "" || hoursText.trim() !== "" || picked.length > 0 || pinned.length > 0

	function discardDraft() {
		if (editing) {
			setBody(baselineBody)
			setHoursText(baselineHours)
			// Back to the last-saved clips – and anything toggled after that stops counting as touched, so a seed still in flight lands clean.
			setPicked(clipSeed.picked)
			setPinned(clipSeed.pinned)
			clipsTouchedRef.current = false
		} else {
			setBody("")
			setHoursText("")
			setPicked([])
		}
		setTab("journal")
		writeJournalAutosave(checkpoint.id, null)
	}

	// The fallback is for a season sheet opened before its project row landed; it must never pick the warm-up project, which has no season week.
	const project =
		projects.find(p => isWeeksProject(week, p)) ?? projects.find(p => p.weekId !== WARMUP_WEEK_ID) ?? projects[0]

	// The claim is what the maker types. The photographs are what makes it a claim rather than a number, which is why the bar rises with it – and they are counted out of the entry itself, so every picture sits in the sentence that explains it instead of in a tray underneath.
	const typed = Math.max(0, Number(hoursText) || 0)
	// The hours box declares what the timelapses do not cover, so the claim is the two added together: 2 typed hours on top of a 5-hour recording logs
	// 7. Leave the box empty and the recording sets the claim on its own – the maker is never asked to retype a number Lapse already has.
	const coveredSeconds = picked.reduce((sum, t) => sum + t.durationSeconds, 0)
	const lapseHours = Math.round((coveredSeconds / 3600) * 100) / 100
	const claimed = typed + lapseHours
	// At least a minute once there is a claim, so a short recording is not rounded down to nothing.
	const sessionMinutes = claimed > 0 ? Math.max(1, Math.round(claimed * 60)) : 0
	// Screenshots back the written entry, so they follow the typed hours: 2 additional hours need two screenshots, however long the timelapses run.
	const needPhotos = photosRequired(typed)
	const shots = countImages(body)
	// Words only: the images are counted above, not twice.
	const written = proseLength(body)

	const longEnough = written >= 200
	const enoughPhotos = shots >= needPhotos
	// A session is backed by a journal entry, a Lapse timelapse, or both together: each one is evidence a reviewer can check the hours against, and the two land on the same entry. A written entry needs its hours typed; a timelapse brings its own.
	const journalled = longEnough && enoughPhotos
	const attachedCount = picked.length + pinned.length + legacyKept.length
	const recorded = attachedCount > 0
	const overCap = claimed > MAX_SESSION_HOURS
	const ok = claimed > 0 && !overCap && (journalled || recorded)

	// One thing at a time – a list of four faults reads as a wall, and only the first one is actionable anyway. Once the hours are in, the entry's next shortfall is named with the other way out beside it, so nobody is told to write 200 characters they could skip with a timelapse.
	const orLapse = " You can also attach Lapse timelapses on the Timelapse tab. They back the same entry."
	const missing = !ok
		? overCap
			? `A single devlog covers at most ${MAX_SESSION_HOURS} hours. Split longer work across sessions.`
			: claimed <= 0
				? "Add the hours you spent on this session, or pick a Lapse timelapse."
				: !longEnough
					? `${200 - written} more characters in your entry, not counting images.${orLapse}`
					: `${needPhotos - shots} more ${needPhotos - shots === 1 ? "image" : "images"} in your entry for ${fmtHours(typed)}.${orLapse}`
		: null

	const hours = hoursOf(week)
	const toFloor = Math.max(0, week.submitHours - hours)
	// The week's earning goal, read off its own target rather than the goal catalogue: targetHours already bakes in this week's tier (weekAsk slides the funded block in underneath the pace) and earnFrom is where coins start, so their difference at the coin rate is what this tier and this goal ask together. Warm-ups have no season pace, so they keep the bare floor message.
	const weeklyGoalCoins = Math.round((week.targetHours - week.earnFrom) * COINS_PER_HOUR)
	const toGoal = Math.max(0, week.targetHours - hours)
	// Makers here for the grant have no machine to pace against – GoalTracker reads the same flag – so the weekly goal means nothing to them and they get the flat rate instead.
	const chasingPrinter = participantGoal === null || participantGoal === ParticipantGoal.PRINTER
	const showGoal = chasingPrinter && week.id !== WARMUP_WEEK_ID && toGoal > 0

	/**
	 * Finishing hands the maker back to the trail rather than straight into another entry. What comes next is the trail's to say: logging these hours may have brought a reel due, or opened the fork at the end of the week, and a modal that reopens itself would march past both.
	 */
	async function save() {
		if (saving || uploading > 0) return
		setSaving(true)
		setSaveError(null)
		if (editing) {
			// The full set the server reconciles against: Lapse picks and pins plus the older uploads, which the server keeps silently – sending them keeps the local snapshot agreeing with it until the refresh.
			const refused = await editSession(checkpoint.id, sessionMinutes, body.trim(), {
				clips: [...legacyKept, ...pinned, ...picked.map(t => t.id)],
			})
			setSaving(false)
			if (refused) setSaveError(refused)
			else {
				clearJournalAutosave(checkpoint.id)
				setOpenCheckpoint(null)
			}
			return
		}
		const refused = await logSession(checkpoint.id, sessionMinutes, body.trim(), {
			clips: picked.map(t => t.id),
		})
		setSaving(false)
		if (refused) {
			setSaveError(refused)
			return
		}
		clearJournalAutosave(checkpoint.id)
		complete(checkpoint.id)
		setOpenCheckpoint(null)
	}

	async function signInWithLapse() {
		stashJournalDraft(checkpoint.id, {
			body: cleanBodyForAutosave(body),
			hoursText,
			legacy: legacyKept,
			picked,
			pinned,
			tab: "timelapse",
		})
		await linkLapse(`${window.location.pathname}?journal=${encodeURIComponent(checkpoint.id)}`)
	}

	/**
	 * Put images into the entry where the cursor is – picked, dropped or pasted, the same way (after Stasis's session form). Each goes in first as a placeholder, `![Uploading name…](uploading:n)`, which no renderer or image count accepts, and is swapped for its CDN link once the upload lands; a failed one is taken back out. One at a time, because uploads are rate-limited per account.
	 */
	async function addJournalImages(sources: Iterable<ImageSource>) {
		const all = Array.from(sources)
		const images = all.filter(s => !(s instanceof File) || s.type.startsWith("image/"))
		const notices: string[] = []
		if (images.length < all.length) notices.push("Only images can go in an entry, so the rest were left out.")

		// Each image a paragraph of its own, wherever in the text it lands.
		const at = entry.current?.selectionEnd ?? body.length
		const before = body.slice(0, at)
		const after = body.slice(at)
		const lead = !before.trim() || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
		const trail = !after || after.startsWith("\n") ? "" : "\n\n"

		// As many as fit, in the order they were given. A picture costs more characters once its link is back than while it is still uploading, so this is the first of two asks about room, not the last.
		const items: { source: ImageSource; alt: string; placeholder: string }[] = []
		let block = ""
		for (const source of images) {
			const alt = altFor(source)
			placeholderSeq.current += 1
			const placeholder = `![Uploading ${alt}…](uploading:${placeholderSeq.current})`
			const piece = items.length === 0 ? lead + placeholder : `\n\n${placeholder}`
			if (before.length + (block + piece).length + trail.length + after.length > MAX_SESSION_CONTENT) break
			block += piece
			items.push({ alt, placeholder, source })
		}
		const short = images.length - items.length
		if (short > 0)
			notices.push(`This entry is full, so ${short === 1 ? "one image was" : `${short} images were`} left out.`)
		setImageError(notices.length > 0 ? notices.join(" ") : null)
		if (items.length === 0) return

		setBody(clampToContentLimit(before + block + trail + after))
		requestAnimationFrame(() => {
			const caret = before.length + block.length
			entry.current?.setSelectionRange(caret, caret)
		})

		setUploading(n => n + items.length)
		for (const item of items)
			try {
				const { url } = await storeImage(item.source)
				if (!url) throw new Error("Image uploads need a public URL before they can be added here")
				const markdown = `![${item.alt}](${url})`
				// The second ask about room. A picture is left out whole rather than the entry cut short – the tail of an entry is somebody's writing, and half an image reads worse than none of it.
				if (!roomFor(item.placeholder, markdown)) {
					swapPlaceholder(item.placeholder, null)
					setImageError(`This entry is full, so "${item.alt}" was left out.`)
					continue
				}
				swapPlaceholder(item.placeholder, markdown)
			} catch (err) {
				swapPlaceholder(item.placeholder, null)
				setImageError(err instanceof Error ? err.message : "The image did not upload")
			} finally {
				setUploading(n => n - 1)
			}
	}

	/**
	 * Whether `markdown` still fits once it stands in for `placeholder`.
	 *
	 * Read off the box rather than `body`, which is the render this handler was made in and has not moved since: the uploads run one at a time, so the box has caught up by the time a link lands and `body` has not.
	 */
	function roomFor(placeholder: string, markdown: string): boolean {
		const current = entry.current?.value ?? body
		return current.length - placeholder.length + markdown.length <= MAX_SESSION_CONTENT
	}

	/**
	 * Replace a placeholder with its link, or take it out (`null`), without moving the caret of someone who kept typing while it uploaded: setting a textarea's value sends the caret to the end, so it is put back, shifted by however much the text before it grew or shrank.
	 */
	function swapPlaceholder(placeholder: string, replacement: string | null) {
		const el = entry.current
		const keep =
			el && document.activeElement === el
				? { at: el.value.indexOf(placeholder), end: el.selectionEnd, length: el.value.length, start: el.selectionStart }
				: null
		setBody(current => {
			const next =
				replacement === null ? withoutPlaceholder(current, placeholder) : current.replace(placeholder, replacement)
			// The backstop under `roomFor`: should a link land against a box that moved underneath it, the entry is still not left longer than the server will take.
			return clampToContentLimit(next)
		})
		if (!keep || keep.at < 0) return
		requestAnimationFrame(() => {
			const box = entry.current
			if (!box) return
			const delta = box.value.length - keep.length
			const move = (p: number) => (p > keep.at ? p + delta : p)
			box.setSelectionRange(move(keep.start), move(keep.end))
		})
	}

	// A drag that could be carrying an image: files, or a picture dragged off another page, which comes as markup and an address rather than a file. Dragging a selection around the entry is plain text, and not ours.
	const mightBeImage = (e: React.DragEvent) =>
		["Files", "text/html", "text/uri-list"].some(t => e.dataTransfer.types.includes(t))

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={`${weekName(week)} · ${checkpoint.title}`}
			footer={
				<JournalFooter
					chasingPrinter={chasingPrinter}
					editing={editing}
					missing={missing}
					ok={ok}
					save={save}
					saveError={saveError}
					saving={saving}
					showGoal={showGoal}
					toFloor={toFloor}
					toGoal={toGoal}
					uploading={uploading}
					week={week}
					weeklyGoalCoins={weeklyGoalCoins}
				/>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			scrollKey={tab}
			size="lg"
		>
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

			{tab === "journal" ? (
				// The whole sheet takes a drop, not just the box: a picture let go an inch off the textarea would otherwise open in the tab and take the unsaved entry with it.
				// biome-ignore lint/a11y/noStaticElementInteractions: a drop target, not a control; dragging is not a keyboard gesture, and the sheet stays reachable through its fields.
				<div
					onDragEnter={e => {
						if (!mightBeImage(e)) return
						e.preventDefault()
						dragDepth.current += 1
						setDragging(true)
					}}
					onDragLeave={e => {
						if (!mightBeImage(e)) return
						dragDepth.current = Math.max(0, dragDepth.current - 1)
						if (dragDepth.current === 0) setDragging(false)
					}}
					onDragOver={e => {
						if (mightBeImage(e)) e.preventDefault()
					}}
					onDrop={e => {
						dragDepth.current = 0
						setDragging(false)
						const found = droppedImages(e.dataTransfer)
						const files = Array.from(e.dataTransfer.files)
						// A link or some text is not an image: left to the textarea, which drops it in as text. Files are always caught, images or not, so a PDF let go over the sheet cannot open in the tab and take the unsaved entry with it.
						if (found.length === 0 && files.length === 0) return
						e.preventDefault()
						void addJournalImages(found.length > 0 ? found : files)
					}}
				>
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
						<p
							className={cx(
								"hand text-[0.76rem] tabular-nums",
								shots >= needPhotos ? "text-teal-ink" : "text-navy-soft",
							)}
						>
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
			) : (
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
									{legacyKept.length === 1 ? "1 older recording" : `${legacyKept.length} older recordings`} kept from
									the original entry.
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
			)}
		</Modal>
	)
}
