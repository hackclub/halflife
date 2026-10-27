"use client"

import Link from "next/link"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { z } from "zod"
import { Gato, WeekPainting } from "@/components/platform/art"
import {
	IconArrowRight,
	IconCamera,
	IconCart,
	IconCheck,
	IconClock,
	IconEye,
	IconFilm,
	IconMic,
	IconPencil,
	IconUpload,
	IconVolume,
	IconVolumeOff,
	IconWarning,
} from "@/components/platform/icons"
import { countImages, Markdown, proseLength } from "@/components/platform/Markdown"
import { RepoInput, repoIsValid } from "@/components/platform/RepoField"
import { ReelCapture } from "@/components/platform/reels/ReelCapture"
import { ProjectChoiceCard, StarterProjectCard } from "@/components/platform/StarterProjectCard"
import { Button, borderedInputClass, Chip, Field, inputClass, OptionRow, Panel } from "@/components/platform/ui"
import { errorMessage, refusalMessage } from "@/lib/api-error"
import { attrUrl } from "@/lib/attr-url"
import { linkLapse } from "@/lib/auth-client"
import { BOM_MARGIN_USD, bomTotalUsd, partsFunding } from "@/lib/bom-policy"
import { type BomLine, BomLineSchema } from "@/lib/bom-schema"
import {
	STARTER_MODIFICATION_NOTE,
	STARTER_PROJECT_TIER,
	starterProjectsFor,
	usesStarterDefaultDescription,
} from "@/lib/config/onboarding"
import { COINS_PER_HOUR, paceTarget, printerById, submitFloorFor } from "@/lib/config/printers"
import { MIN_PROJECT_DESCRIPTION_CHARS, THEMES, WARMUP_WEEK_ID } from "@/lib/config/program"
import { ENTRY_TIER, getTier } from "@/lib/config/tiers"
import { photosRequired, TIERS } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { formatShortDate } from "@/lib/deadline"
import { ParticipantGoal } from "@/lib/enums"
import { type LapseTimelapse, LapseTimelapseSchema } from "@/lib/lapse-timelapses"
import { round2 } from "@/lib/money"
import { fmtHours } from "@/lib/numbers"
import {
	PLATFORM_INFO,
	PUBLIC_REEL_HASHTAG,
	PUBLIC_REEL_PLATFORMS,
	type PublicReelPlatform,
	readPublicReelLink,
} from "@/lib/public-reels"
import { validateRepoField } from "@/lib/repo"
import type { RepoCheckResult } from "@/lib/repo-checks"
import { SUBMISSION_LIMIT } from "@/lib/resubmissions"
import { EXAMPLE_JOURNAL_URL } from "@/lib/routes"
import { MAX_SESSION_CONTENT, MAX_SESSION_HOURS } from "@/lib/schemas/session"
import { usePrinterPace, useStore, weekListPhrase } from "@/lib/store"
import type { Checkpoint, Project, Week } from "@/lib/types"
import { isRecord } from "@/lib/unknown"
import { IMAGE_ACCEPT } from "@/lib/uploads/image-accept"
import { uploadFile } from "@/lib/use-handoff"
import { ImageUploads, type UploadedImage } from "./ImageUploads"
import { fmtDuration, LapsePicker } from "./LapsePicker"
import { Modal, ModalTitle } from "./Modal"
import { RepoChecks } from "./RepoChecks"
import { type SubmissionReel, SubmissionReelPicker } from "./SubmissionReelPicker"

/* ================================================================== *
 * Journal + timelapse
 * ================================================================== */
/** Hours, written the way a person says them. */
/**
 * How a sheet names its week. The warm-up is week 0 in the store, which is only an address; to the person it is their warm-up.
 */
function weekName(week: { id: number }): string {
	return week.id === WARMUP_WEEK_ID ? "Warm-up" : `Week ${week.id}`
}

/**
 * Whether a project is the one a week's sheet is about: a warm-up's own week names its project, and a season week's project is its design week's.
 */
function isWeeksProject(week: Week, project: Project): boolean {
	if (week.projectId) return project.id === week.projectId
	return project.weekId === (week.phase === "build" ? week.id - 5 : week.id)
}

/** The parts list read. A refusal carries none of these fields, so it is read before the shape it is not. */
const BomResponseSchema = z.object({
	items: z.array(BomLineSchema),
	taxShippingUsd: z.number(),
})

const JournalDraftSchema = z.object({
	body: z.string(),
	hoursText: z.string(),
	/** Older non-Lapse clips, preserved untouched. */
	legacy: z.array(z.string()).optional(),
	picked: z.array(LapseTimelapseSchema),
	/** Lapse clips kept from the original entry that Lapse would not re-verify. */
	pinned: z.array(z.string()).optional(),
	tab: z.enum(["journal", "timelapse"]),
})
type JournalDraft = z.infer<typeof JournalDraftSchema>

const LapseResolveBodySchema = z.object({
	legacy: z.array(z.string()).optional(),
	pinned: z.array(z.string()).optional(),
	resolved: z.array(LapseTimelapseSchema).optional(),
})

const PublicLinksErrorSchema = z.object({
	error: z
		.object({
			details: z.object({ fields: z.partialRecord(z.enum(PUBLIC_REEL_PLATFORMS), z.string()).optional() }).optional(),
			message: z.string().optional(),
		})
		.optional(),
})

const draftKey = (checkpointId: string) => `halflife.journal-draft.${checkpointId}`

/** Held for the sign-in round trip to Lapse, which leaves the page. */
function stashJournalDraft(checkpointId: string, draft: JournalDraft) {
	try {
		window.sessionStorage.setItem(draftKey(checkpointId), JSON.stringify(draft))
	} catch {
		// Private mode or storage off: the trip still works, the draft just does not survive it.
	}
}

function isJournalDraft(value: unknown): value is JournalDraft {
	return JournalDraftSchema.safeParse(value).success
}

function peekJournalTrip(checkpointId: string): JournalDraft | null {
	if (typeof window === "undefined") return null
	try {
		const raw = window.sessionStorage.getItem(draftKey(checkpointId))
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		return isJournalDraft(parsed) ? parsed : null
	} catch {
		return null
	}
}

const autosaveKey = (checkpointId: string) => `halflife.journal-autosave.${checkpointId}`

/** Placeholders for images still uploading: never persisted, their upload dies with the page. */
const UPLOADING_PLACEHOLDER = /!\[Uploading .*?\]\(uploading:\d+\)/g

function cleanBodyForAutosave(body: string): string {
	return body.replaceAll(UPLOADING_PLACEHOLDER, "").replaceAll(/\n{3,}/g, "\n\n")
}

/**
 * An entry no longer than the server will take, cut from the end.
 *
 * Every write to the box ends here. `maxLength` only covers what a person types or pastes – an image arrives as a `setBody` the browser had no say in, and costs more characters once its link is back than the placeholder that stood in for it – so the box can still be handed something the server would refuse.
 */
function clampToContentLimit(body: string): string {
	return body.length > MAX_SESSION_CONTENT ? body.slice(0, MAX_SESSION_CONTENT) : body
}

/** A draft that survives closing the sheet, reloading, or navigating away. Cleared on save. */
function readJournalAutosave(checkpointId: string): JournalDraft | null {
	if (typeof window === "undefined") return null
	try {
		const raw = window.localStorage.getItem(autosaveKey(checkpointId))
		if (!raw) return null
		const parsed: unknown = JSON.parse(raw)
		return isJournalDraft(parsed) ? parsed : null
	} catch {
		return null
	}
}

function writeJournalAutosave(checkpointId: string, draft: JournalDraft | null) {
	try {
		if (draft) window.localStorage.setItem(autosaveKey(checkpointId), JSON.stringify(draft))
		else window.localStorage.removeItem(autosaveKey(checkpointId))
	} catch {
		// Storage off: the sheet still works, it just cannot keep the draft.
	}
}

function clearJournalAutosave(checkpointId: string) {
	try {
		window.localStorage.removeItem(autosaveKey(checkpointId))
		window.sessionStorage.removeItem(draftKey(checkpointId))
	} catch {
		// Storage off or already cleared.
	}
}

/** An image for the entry: a file, or the address of one on another page. */
type ImageSource = File | { url: string; alt: string }

const IMAGE_ADDRESS = /^(https?:\/\/|data:image\/)/i

/**
 * The images in a drop. Files when there are any; otherwise a picture dragged off another page, which arrives as the page's markup for it (read in an inert document, so nothing loads) and failing that as a bare address that looks like an image. A plain link comes back empty.
 */
function droppedImages(transfer: DataTransfer): ImageSource[] {
	const files = Array.from(transfer.files).filter(f => f.type.startsWith("image/"))
	if (files.length > 0) return files
	const html = transfer.getData("text/html")
	if (html) {
		const found = Array.from(new DOMParser().parseFromString(html, "text/html").images)
			.map(img => ({ alt: img.alt, url: img.getAttribute("src")?.trim() ?? "" }))
			.filter(img => IMAGE_ADDRESS.test(img.url))
		if (found.length > 0) return found
	}
	return transfer
		.getData("text/uri-list")
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line && !line.startsWith("#") && /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(?:[?#]\S*)?$/i.test(line))
		.map(url => ({ alt: "", url }))
}

/** Alt text for an image: what the page called it, else its file name. */
function altFor(source: ImageSource): string {
	let name = source instanceof File ? source.name : source.alt
	if (!name && !(source instanceof File) && !source.url.startsWith("data:"))
		try {
			name = decodeURIComponent(new URL(source.url).pathname.split("/").pop() ?? "")
		} catch {
			name = ""
		}

	return (
		name
			.replace(/\.[^.]+$/, "")
			.replaceAll(/[[\]()]/g, "")
			.trim()
			.slice(0, 80) || "Journal image"
	)
}

/**
 * Put an image in the bucket and hand back its CDN link. A file uploads as itself. An inline `data:` picture is already here, so it uploads as a file too. An address on another site is fetched and re-hosted by the server (/api/upload/from-url): the browser cannot read another site's image, and a hotlinked one can change or vanish after the entry is reviewed.
 */
async function storeImage(source: ImageSource): Promise<{ url: string | null }> {
	if (source instanceof File) return uploadFile(source, "sessions")
	if (source.url.startsWith("data:")) {
		const blob = await (await fetch(source.url)).blob()
		const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"
		return uploadFile(new File([blob], `image.${ext}`, { type: blob.type }), "sessions")
	}
	const res = await fetch("/api/upload/from-url", {
		body: JSON.stringify({ url: source.url }),
		headers: { "content-type": "application/json" },
		method: "POST",
	})
	const payload: unknown = await res.json().catch(() => null)
	if (!res.ok) throw new Error(errorMessage(payload, `That image did not upload (${res.status})`))
	return { url: isRecord(payload) && typeof payload.url === "string" ? payload.url : null }
}

/** Take an image's placeholder back out of the entry, with the blank line it came with. */
function withoutPlaceholder(body: string, placeholder: string): string {
	for (const form of [`\n\n${placeholder}`, `${placeholder}\n\n`, placeholder])
		if (body.includes(form)) return body.replace(form, "")
	return body
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
									{fmtHours(toFloor)} more before you can{" "}
									{week.id === WARMUP_WEEK_ID ? "submit it" : "wrap up the week"}
									{showGoal ? (
										<>
											, and {fmtHours(toGoal)} more if you want to reach your goal of{" "}
											<strong className="rounded bg-gold-pale px-1 text-gold-ink">{weeklyGoalCoins} coins</strong> per
											week.
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

/* ================================================================== *
 * Reel
 * ================================================================== */
const ReelDraftSchema = z.object({
	caption: z.string(),
	clip: z.string(),
	/** The bucket's URL for the clip, never a blob URL: those die with the page. */
	url: z.string().nullable(),
})
type ReelDraft = z.infer<typeof ReelDraftSchema>

const reelDraftKey = (checkpointId: string) => `halflife.reel-draft.${checkpointId}`

/**
 * A reel's draft is the clip already sitting in the bucket plus its caption. The upload is the expensive half and it has already happened by the time Save draft is on offer, so keeping the draft is keeping a key and a line of text – in this browser, like the rest of the ceremony, and cleared on post.
 */
function readReelDraft(checkpointId: string): ReelDraft | null {
	if (typeof window === "undefined") return null
	try {
		const raw = window.localStorage.getItem(reelDraftKey(checkpointId))
		const parsed = raw ? ReelDraftSchema.safeParse(JSON.parse(raw)) : null
		return parsed?.success ? parsed.data : null
	} catch {
		return null
	}
}

function writeReelDraft(checkpointId: string, draft: ReelDraft | null) {
	try {
		if (draft) window.localStorage.setItem(reelDraftKey(checkpointId), JSON.stringify(draft))
		else window.localStorage.removeItem(reelDraftKey(checkpointId))
	} catch {
		// Storage off: Save draft still closes the sheet, it just cannot keep it.
	}
}

/**
 * After a reel posts: would they like to post it online too?
 *
 * Asked once, as a yes-or-no, so saying no costs one click. Yes opens the links – one field per platform, all optional but at least one – with the reminder that makes the post count at the top, because it has to be in the caption *before* they post it: their referral link and the programme's hashtag. Each link is saved as its own Public Reels row against this reel.
 */
export function PublicReelModal({
	postId,
	eyebrow,
	videoUrl,
	onClose,
	start = "ask",
	celebration,
}: {
	postId: string
	eyebrow: string
	/** The clip, so it can be saved and uploaded elsewhere. */
	videoUrl: string | null
	onClose(): void
	/**
	 * "links" skips the question – for the Reels page, where pressing "Add where you posted it" has already answered it.
	 */
	start?: "ask" | "links"
	/**
	 * Set when this sheet is the confirmation of a design hand-in: it congratulates, and says what the hours past the tier turn into once a reviewer approves them. Other callers (a reel posted mid-week, the Reels page) pass nothing and see the plain ask.
	 */
	celebration?: { extraHours: number }
}) {
	const [step, setStep] = useState<"ask" | "links" | "saved">(start)
	const titleId = useId()
	const [values, setValues] = useState<Record<PublicReelPlatform, string>>({
		INSTAGRAM: "",
		TIKTOK: "",
		X: "",
		YOUTUBE: "",
	})
	const [errors, setErrors] = useState<Partial<Record<PublicReelPlatform, string>>>({})
	const [saving, setSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [referral, setReferral] = useState<
		{ state: "loading" } | { state: "ready"; link: string } | { state: "error" }
	>({ state: "loading" })
	const [copied, setCopied] = useState<"link" | "caption" | null>(null)

	// Asked for only once they say yes: most people will not, and the lookup reaches the signup list.
	useEffect(() => {
		if (step !== "links" || referral.state !== "loading") return
		let cancelled = false
		void (async () => {
			try {
				// A POST, because the route writes: reading a link assigns the referral code and records the address on the signup list.
				const res = await fetch("/api/me/referral", { cache: "no-store", method: "POST" })
				const body: unknown = await res.json().catch(() => null)
				if (cancelled) return
				setReferral(
					res.ok && isRecord(body) && typeof body.link === "string"
						? { link: body.link, state: "ready" }
						: { state: "error" },
				)
			} catch {
				if (!cancelled) setReferral({ state: "error" })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [step, referral.state])

	async function copy(text: string, which: "link" | "caption") {
		try {
			await navigator.clipboard.writeText(text)
			setCopied(which)
			window.setTimeout(() => setCopied(c => (c === which ? null : c)), 2000)
		} catch {
			// Clipboard refused: the text is on screen and selectable.
		}
	}

	const filled = PUBLIC_REEL_PLATFORMS.filter(p => values[p].trim())

	async function save() {
		if (saving) return
		// The same check the server runs, so a wrong link is named on its field before anything is sent.
		const found: Partial<Record<PublicReelPlatform, string>> = {}
		for (const p of filled) {
			const read = readPublicReelLink(p, values[p])
			if ("error" in read) found[p] = read.error
		}
		setErrors(found)
		setSaveError(null)
		if (Object.keys(found).length > 0) return

		setSaving(true)
		try {
			const res = await fetch(`/api/posts/${postId}/public-links`, {
				body: JSON.stringify({ links: filled.map(platform => ({ platform, url: values[platform] })) }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			if (!res.ok) {
				const parsed = PublicLinksErrorSchema.safeParse(await res.json().catch(() => null))
				const fields = parsed.success ? parsed.data.error?.details?.fields : undefined
				if (fields && Object.keys(fields).length > 0) setErrors(fields)
				else
					setSaveError(
						(parsed.success ? parsed.data.error?.message : undefined) ?? "Your links didn't save. Try again.",
					)
				return
			}
			setStep("saved")
		} catch {
			setSaveError("Could not reach the server. Your links are still here. Try again.")
		} finally {
			setSaving(false)
		}
	}

	if (step === "ask")
		return (
			<Modal
				accent="var(--color-violet)"
				eyebrow={eyebrow}
				footer={
					<>
						<Button onClick={onClose} variant="outline">
							Not now
						</Button>
						<Button onClick={() => setStep("links")} variant="solid">
							Yes, post it online <IconArrowRight className="text-base" />
						</Button>
					</>
				}
				labelledBy={titleId}
				onClose={onClose}
				open
				size="md"
			>
				{celebration && (
					<div
						className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-mint px-5 py-4"
						style={{ "--sk-color": "var(--color-teal)", "--sk-radius": "16px" }}
					>
						<IconCheck className="mt-0.5 shrink-0 text-xl text-teal-deep" />
						<div className="min-w-0">
							<p className="text-[0.95rem] leading-snug font-extrabold text-navy">
								Congratulations, your design is submitted!
							</p>
							<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
								{celebration.extraHours > 0 ? (
									<>
										Once review is complete and assuming no deflation, you&apos;ll earn{" "}
										<strong className="rounded bg-gold-pale px-1 text-gold-ink">coins</strong> at 5 per hour for your{" "}
										{fmtHours(celebration.extraHours)} past your tier&apos;s funded hours.
									</>
								) : (
									<>It&apos;s with the reviewers now.</>
								)}
							</p>
						</div>
					</div>
				)}
				<ModalTitle id={titleId} sub="You'll earn coins if your post goes viral!">
					Would you like to post your reel online?
				</ModalTitle>
				<p className="hand text-[0.84rem] text-navy-soft">
					Your reel is already on the Doomscroller. This is for Instagram, TikTok, X or YouTube too.
				</p>
			</Modal>
		)

	if (step === "saved")
		return (
			<Modal
				accent="var(--color-teal)"
				eyebrow={eyebrow}
				footer={
					<Button onClick={onClose} variant="solid">
						Done <IconCheck className="text-base" />
					</Button>
				}
				labelledBy={titleId}
				onClose={onClose}
				open
				size="md"
			>
				<ModalTitle
					id={titleId}
					sub={`${filled.length === 1 ? "Your link is" : `All ${filled.length} links are`} saved. If a post takes off, we'll be in touch about your coins.`}
				>
					Good luck going viral
				</ModalTitle>
			</Modal>
		)

	const captionLine = referral.state === "ready" ? `${referral.link} ${PUBLIC_REEL_HASHTAG}` : PUBLIC_REEL_HASHTAG

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={eyebrow}
			footer={
				<>
					<p
						className={cx(
							"hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug",
							saveError ? "text-coral-deep" : "text-navy-soft",
						)}
						role={saveError ? "alert" : undefined}
					>
						{saveError ?? (filled.length === 0 ? "Paste at least one link to save." : " ")}
					</p>
					<Button disabled={saving} onClick={onClose} variant="outline">
						Skip
					</Button>
					<Button disabled={filled.length === 0 || saving} onClick={() => save()} variant="solid">
						{saving ? "Saving…" : "Save links"}
					</Button>
				</>
			}
			labelledBy={titleId}
			onClose={onClose}
			open
			size="lg"
		>
			{/* First, because it has to be in the caption before the post goes up. */}
			<div
				className="sketch mb-5 rounded-2xl bg-sky-pale px-5 py-4"
				style={{ "--sk-color": "var(--color-sky)", "--sk-radius": "16px" }}
			>
				<p className="label text-navy">Before you post</p>
				<p className="mt-1.5 text-[0.9rem] leading-snug text-navy">
					Put your referral link and <span className="font-bold">{PUBLIC_REEL_HASHTAG}</span> in the caption, so we can
					find your post and anyone who joins from it counts for you.
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{referral.state === "loading" ? (
						<p aria-live="polite" className="hand text-[0.84rem] text-navy-soft">
							getting your referral link…
						</p>
					) : referral.state === "error" ? (
						<p className="hand text-[0.84rem] text-coral-deep">
							Your referral link isn&apos;t available right now. The hashtag still counts.
						</p>
					) : (
						<code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 font-mono text-[0.84rem] text-navy">
							{referral.link}
						</code>
					)}
					{referral.state === "ready" && (
						<Button onClick={() => copy(referral.link, "link")} size="sm" variant="outline">
							{copied === "link" ? "Copied!" : "Copy link"}
						</Button>
					)}
					<Button onClick={() => copy(captionLine, "caption")} size="sm" variant="outline">
						{copied === "caption" ? "Copied!" : referral.state === "ready" ? "Copy link + hashtag" : "Copy hashtag"}
					</Button>
				</div>
				{videoUrl && (
					<a
						className="hand mt-3 inline-block text-[0.84rem] text-sky-ink underline decoration-dashed underline-offset-4 hover:text-navy"
						download="half-life-reel.mp4"
						href={attrUrl(videoUrl)}
					>
						save your reel to upload it
					</a>
				)}
			</div>

			<ModalTitle
				id={titleId}
				sub="Paste the link from each post's Share button. Fill in the ones you posted to, and leave the rest blank."
			>
				Where did you post it?
			</ModalTitle>

			<div className="grid gap-4 sm:grid-cols-2">
				{PUBLIC_REEL_PLATFORMS.map(p => {
					const info = PLATFORM_INFO[p]
					const fieldId = `${titleId}-${p}`
					const error = errors[p]
					return (
						<div className="grid gap-1.5" key={p}>
							<label className="label text-violet-deep" htmlFor={fieldId}>
								{info.label}
							</label>
							<input
								aria-describedby={error ? `${fieldId}-error` : undefined}
								aria-invalid={error ? true : undefined}
								autoComplete="off"
								className={cx(
									"block w-full rounded-xl border-2 bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-line-strong focus:border-violet focus:bg-white",
									error ? "border-coral-deep bg-coral/5" : "border-line",
								)}
								id={fieldId}
								inputMode="url"
								onChange={e => {
									const v = e.target.value
									setValues(prev => ({ ...prev, [p]: v }))
									if (errors[p])
										setErrors(prev => {
											const next = { ...prev }
											delete next[p]
											return next
										})
								}}
								placeholder={info.example}
								spellCheck={false}
								value={values[p]}
							/>
							{error && (
								<p className="text-[0.8rem] leading-snug font-semibold text-coral-deep" id={`${fieldId}-error`}>
									{error}
								</p>
							)}
						</div>
					)
				})}
			</div>
		</Modal>
	)
}

export function ReelModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const { setOpenCheckpoint, postReel, stateOf, weekOf } = useStore()
	const week = weekOf(checkpoint.weekId)
	const { done } = stateOf(checkpoint.id)
	// A reel draft is restored once, when the sheet opens, and never changes while it is open – so it is a value to read, not one to set.
	// oxlint-disable-next-line react/hook-use-state
	const [draft] = useState(() => readReelDraft(checkpoint.id))
	const [clip, setClip] = useState<string | null>(draft?.clip ?? null)
	// What the preview plays: a blob URL for a file picked on this machine, the bucket's URL for one filmed on the phone or restored from a draft.
	const [previewUrl, setPreviewUrl] = useState<string | null>(draft?.url ?? null)
	// Kept apart from the preview because a blob URL cannot outlive the page, so it is never what a draft remembers.
	const [clipUrl, setClipUrl] = useState<string | null>(draft?.url ?? null)
	const [caption, setCaption] = useState(draft?.caption ?? "")

	// `autoPlay` alone is a request the browser may defer (a tab that was not focused when the clip arrived, say), so the preview asks once more itself. Sound starts off: autoplay with audio is refused, so the preview opens muted and the speaker toggle below is the gesture that allows it.
	const previewVideo = useRef<HTMLVideoElement>(null)
	const [muted, setMuted] = useState(true)
	useEffect(() => {
		const video = previewVideo.current
		if (!video) return
		// The `muted` attribute only sets the initial state – React re-renders do not move the property after mount – so the toggle writes it here.
		video.muted = muted
		void (async () => {
			try {
				await video.play()
			} catch {
				// Autoplay refuses before a gesture; the play button below is the fallback.
			}
		})()
	}, [previewUrl, muted])

	// A blob URL holds the whole video in memory until it is revoked.
	useEffect(
		() => () => {
			if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl)
		},
		[previewUrl],
	)

	function capture(key: string | null, url?: string | null) {
		setClip(key)
		setPreviewUrl(url ?? null)
		setClipUrl(url && !url.startsWith("blob:") ? url : null)
		setMuted(true)
	}

	// Posting waits for the server, so there is a post to hang public links on and so a failure says so instead of closing on a reel that never landed.
	const [posting, setPosting] = useState(false)
	const [postError, setPostError] = useState<string | null>(null)
	const [postedId, setPostedId] = useState<string | null>(null)

	async function post() {
		if (!clip || posting) return
		setPosting(true)
		setPostError(null)
		const { postId, error } = await postReel(checkpoint.id, caption.trim(), clip)
		setPosting(false)
		if (error) {
			setPostError(error)
			return
		}
		writeReelDraft(checkpoint.id, null)
		setPostedId(postId ?? null)
	}

	// A finished reel asks before it opens the recorder: the checkpoint is done, and another reel is an extra, so reopening one should say that rather than look like the checkpoint asking for its reel again. A draft already under way for it means that question was answered last time.
	const [again, setAgain] = useState(!done || draft !== null)
	const titleId = useId()
	const captionLength = caption.trim().length
	const captionReady = captionLength >= 8
	const captionBlocker = captionReady
		? null
		: `Caption needs ${8 - captionLength} more character${8 - captionLength === 1 ? "" : "s"} (${captionLength}/8).`
	const postBlocker = !clip ? "Add a clip before posting this reel." : captionBlocker

	// Posted: the same sheet now asks whether it is going anywhere else. The clip's URL comes along so it can be saved and uploaded there.
	if (postedId)
		return (
			<PublicReelModal
				eyebrow={`${weekName(week)} · ${checkpoint.title}`}
				onClose={() => setOpenCheckpoint(null)}
				postId={postedId}
				videoUrl={previewUrl}
			/>
		)

	if (!again)
		return (
			<Modal
				accent="var(--color-teal)"
				eyebrow={`${weekName(week)} · ${checkpoint.title}`}
				footer={
					<>
						<Button onClick={() => setOpenCheckpoint(null)} variant="outline">
							Not now
						</Button>
						<Button onClick={() => setAgain(true)} variant="solid">
							Post another reel <IconFilm className="text-base" />
						</Button>
					</>
				}
				labelledBy={titleId}
				onClose={() => setOpenCheckpoint(null)}
				open
				size="md"
			>
				<ModalTitle
					id={titleId}
					sub="Your first one will stay up, your new one will be added to your project's timeline. If you want to delete the reel, go to the Reels Manager tab!"
				>
					You&apos;ve completed this checkpoint! Would you like to post another reel?
				</ModalTitle>
			</Modal>
		)

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={`${weekName(week)} · ${checkpoint.title}`}
			footer={
				<>
					{postError ? (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep" role="alert">
							{postError}
						</p>
					) : postBlocker ? (
						<p
							className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep"
							id="reel-caption-blocker"
							role="status"
						>
							{postBlocker}
						</p>
					) : (
						<p className="hand hidden text-[0.78rem] text-navy-soft sm:block">
							Reels post straight to the Doomscroller.
						</p>
					)}
					<Button
						onClick={() => {
							writeReelDraft(checkpoint.id, clip || caption.trim() ? { caption, clip: clip ?? "", url: clipUrl } : null)
							setOpenCheckpoint(null)
						}}
						variant="outline"
					>
						{/* On a finished checkpoint with nothing started there is no draft to keep – it is just the answer to "another one?" */}
						{done && !clip && !caption.trim() ? "Not now" : "Save draft"}
					</Button>
					<Button disabled={Boolean(postBlocker) || posting} onClick={() => post()} variant="solid">
						{posting ? "Posting…" : done ? "Post another reel" : "Post reel"} <IconFilm className="text-base" />
					</Button>
				</>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			size="lg"
		>
			{/* Past the question: this is an extra reel, not the checkpoint's own. */}
			{done ? (
				<ModalTitle sub="Your first one stays up, and this one joins it on your project.">Post another reel</ModalTitle>
			) : (
				<ModalTitle sub={checkpoint.blurb}>Make your {checkpoint.title.toLowerCase()}</ModalTitle>
			)}

			<div className="grid gap-6 md:grid-cols-[1fr_200px]">
				<div className="grid gap-4">
					<div
						className="sketch rounded-2xl bg-sky-pale px-5 py-4"
						style={{ "--sk-color": "var(--color-sky)", "--sk-radius": "16px" }}
					>
						<p className="label flex items-center gap-2 text-sky-ink">
							<IconMic className="text-base" /> What to film
						</p>
						<p className="mt-1.5 text-[0.92rem] leading-snug text-navy">{checkpoint.reelBrief}</p>
					</div>

					<div className="grid gap-2">
						<p className="label flex items-center gap-2 text-navy-soft">
							<IconCamera className="text-base" /> Your clip
						</p>
						<p className="text-[0.88rem] leading-snug text-navy-soft">
							Vertical, 30 to 60 seconds, filmed on whatever you have. No editing required.
						</p>
						<ReelCapture objectKey={clip} onCaptured={capture} />
					</div>

					<Field
						hint={captionReady ? "One line. Say what changed." : `At least 8 characters (${captionLength}/8).`}
						id="reel-caption"
						label="Caption"
					>
						<input
							aria-describedby={postBlocker ? "reel-caption-blocker" : undefined}
							aria-invalid={!captionReady || undefined}
							className={inputClass}
							id="reel-caption"
							onChange={e => setCaption(e.target.value)}
							placeholder="routed the whole board without a single ratline left"
							value={caption}
						/>
					</Field>
				</div>

				<div className="mx-auto w-45 md:w-full">
					<p className="label mb-2 text-navy-soft">Preview</p>
					<div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "9 / 16" }}>
						{clip ? (
							<>
								{/* The clip itself, looping the way the Doomscroller will show it. Without a URL (a draft on a deployment with no public bucket URL) it says so rather than standing a stock illustration in for someone's footage. */}
								{previewUrl ? (
									<>
										<video
											aria-label="Preview of your reel"
											autoPlay
											className="absolute inset-0 size-full bg-navy object-cover"
											key={previewUrl}
											loop
											muted
											playsInline
											ref={previewVideo}
											src={attrUrl(previewUrl)}
										/>
										<button
											aria-label={muted ? "Unmute the preview" : "Mute the preview"}
											aria-pressed={!muted}
											className="absolute top-2 right-2 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
											onClick={() => setMuted(m => !m)}
											type="button"
										>
											{muted ? <IconVolumeOff className="text-lg" /> : <IconVolume className="text-lg" />}
										</button>
									</>
								) : (
									<div className="absolute inset-0 grid place-items-center bg-navy px-4 text-center">
										<p className="flex flex-col items-center gap-2 text-[0.78rem] leading-snug text-white/85">
											<IconFilm className="text-2xl text-white" />
											Uploaded. The preview plays once it is posted.
										</p>
									</div>
								)}
								<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2.5 pt-8">
									<p className="text-[0.7rem] leading-snug font-semibold text-white">
										{caption || "your caption here"}
									</p>
								</div>
							</>
						) : (
							<div
								className="sketch grid size-full place-items-center rounded-xl bg-white px-3 text-center"
								style={{ "--sk-radius": "12px" }}
							>
								<p className="hand text-[0.78rem] leading-snug text-navy-soft">nothing here yet</p>
							</div>
						)}
					</div>
				</div>
			</div>
		</Modal>
	)
}

/* ================================================================== *
 * Project creation (weeks 2-5, and week 1 once its project is deleted)
 * ================================================================== */
export function ProjectModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const { setOpenCheckpoint, complete, addProject, ensureProject, experience, weekOf, projects } = useStore()
	const week = weekOf(checkpoint.weekId)
	const pace = usePrinterPace()
	// Opening "create a project" is what makes the week's project row – not signing up, when nobody knows yet whether they will get this far.
	useEffect(() => {
		void ensureProject(checkpoint.weekId)
	}, [checkpoint.weekId, ensureProject])
	// Set when an admin redoes a finished form: it starts from what the project already says rather than from blank.
	const existing = projects.find(p => p.weekId === checkpoint.weekId)
	const [name, setName] = useState(existing?.name ?? "")
	const [desc, setDesc] = useState(existing?.description ?? "")
	const [tier, setTier] = useState<1 | 2 | 3>(
		existing?.tier ?? (experience === "lots" ? 3 : experience === "some" ? 2 : 1),
	)
	const [repo, setRepo] = useState(existing?.githubRepo ?? "")
	// The week's starter projects, for someone who said they are new to hardware. Weeks follow the theme order, design then build, so the week number names the theme.
	const theme = THEMES[(week.id - 1) % THEMES.length]?.id
	const starters = theme && (experience === "first" || experience === "little") ? starterProjectsFor(theme) : []
	// Taking one fills the form in and holds the tier at 1, as onboarding does.
	const [starterId, setStarterId] = useState<string | null>(existing?.starterProjectId ?? null)
	const [pick, setPick] = useState<string | null | undefined>(
		existing ? (existing.starterProjectId ?? null) : undefined,
	)
	const [stage, setStage] = useState<"choose" | "details">(starters.length > 0 ? "choose" : "details")
	const takeStarter = (s: (typeof starters)[number]) => {
		setPick(s.id)
	}
	const chooseCustom = () => {
		setPick(null)
	}
	const advance = () => {
		if (pick === undefined) return
		if (pick === null) setStarterId(null)
		else {
			const s = starters.find(x => x.id === pick)
			setStarterId(pick)
			if (s) setName(s.title)
			setTier(STARTER_PROJECT_TIER)
		}
		setStage("details")
	}

	const ok = name.trim().length > 1 && desc.trim().length > 4 && repoIsValid(repo)
	const selectedStarter = starterId === null ? undefined : starters.find(s => s.id === starterId)

	return (
		<Modal
			accent={week.accent}
			eyebrow={`Week ${week.id} · ${week.fullName}`}
			footer={
				<>
					{stage === "details" && starters.length > 0 && (
						<Button className="mr-auto" onClick={() => setStage("choose")} type="button" variant="outline">
							Back
						</Button>
					)}
					{stage === "choose" && starters.length > 0 && (
						<Button disabled={pick === undefined} onClick={advance} variant="solid">
							Next <IconArrowRight className="text-base" />
						</Button>
					)}
					{stage === "details" && (
						<Button
							disabled={!ok}
							onClick={() => {
								addProject({
									buildStatus: "draft",
									description: desc.trim(),
									designStatus: "draft",
									githubRepo: validateRepoField(repo).url,
									name: name.trim(),
									starter: starterId !== null,
									starterProjectId: starterId,
									tier,
									weekId: week.id,
								})
								complete(checkpoint.id, { artefacts: 1 })
								setOpenCheckpoint(null)
							}}
							variant="solid"
						>
							Create project <IconArrowRight className="text-base" />
						</Button>
					)}
				</>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			size="lg"
		>
			<ModalTitle sub={week.summary}>{week.headline}</ModalTitle>

			{/* Starting a week with weeks already behind you is when the printer's fine print matters, and about the last moment it is any use: the coins being paced toward come from approved weeks, and some of those have gone. Only somebody saving for a machine hears it – a funding-only maker has no prize to fall short of. */}
			{pace.printer && pace.missedWeeks.length > 0 && (
				<div
					className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
					style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" }}
				>
					<IconWarning className="mt-0.5 shrink-0 text-xl text-coral-deep" />
					<div className="min-w-0">
						<p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
							You&apos;re behind on your printer goal.
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							{weekListPhrase(pace.missedWeeks)} passed without being approved, and coins only come from an approved
							week. A <span className="font-bold text-navy">{pace.printer.name}</span> asks about{" "}
							<span className="font-bold text-navy tabular-nums">{pace.perWeekCoins}</span> coins every design week, so
							you may not be eligible for it, because the bigger prizes need all 5 themes finished. A bigger week later
							can make some of it up.
						</p>
					</div>
				</div>
			)}

			{stage === "choose" ? (
				<div className="grid gap-3 sm:grid-cols-2">
					{starters.length > 0 && <p className="col-span-full label mb-2 text-left text-violet-deep">Step 1 / 2</p>}
					{starters.map(s => (
						<StarterProjectCard
							action={
								<Button
									aria-pressed={pick === s.id}
									onClick={() => takeStarter(s)}
									size="sm"
									type="button"
									variant={pick === s.id ? "teal" : "outline"}
								>
									Use starter project
									{pick === s.id ? <IconCheck className="text-base" /> : null}
								</Button>
							}
							chosen={pick === s.id}
							key={s.id}
							stacked
							starter={s}
						/>
					))}
					<ProjectChoiceCard
						action={
							<Button
								aria-pressed={pick === null}
								onClick={chooseCustom}
								size="sm"
								type="button"
								variant={pick === null ? "teal" : "outline"}
							>
								Make a custom project
								{pick === null ? <IconCheck className="text-base" /> : null}
							</Button>
						}
						art={<Gato className="h-35 w-auto" pose="schematic" sizes="260px" />}
						chosen={pick === null}
						label="Custom project"
						stacked
						tileClassName="bg-violet-pale"
						title="Your own idea"
					>
						<p className="mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft">
							Make your own project! It can be anything you want within this week&rsquo;s theme: {week.fullName}.
						</p>
					</ProjectChoiceCard>
					{/* Only once a starter is the pick: it is a rule about the choice, not about the step, and beside "make your own" it read as a warning about the whole fork. */}
					{typeof pick === "string" && (
						<div className="mt-3 rounded-2xl border-2 border-dashed border-gold-deep/40 bg-gold-pale/50 px-4 py-3 text-[0.86rem] leading-relaxed text-navy-soft sm:col-span-2">
							{STARTER_MODIFICATION_NOTE}
						</div>
					)}
				</div>
			) : (
				<div className="grid gap-6 lg:grid-cols-[1fr_230px] lg:items-start">
					<div className="grid gap-4">
						{starters.length > 0 && <p className="label mb-2 text-left text-violet-deep">Step 2 / 2</p>}
						<p className="hand mb-2 text-left text-[0.8rem] text-navy-soft">
							Tier can be changed any time before you submit this week.
						</p>
						{starterId !== null && (
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
								<Chip tone="teal">
									<IconCheck className="text-[0.9rem]" /> Building {selectedStarter?.title ?? "starter"}
								</Chip>
								<button
									className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
									onClick={() => setStage("choose")}
									type="button"
								>
									Choose a different starting point
								</button>
							</div>
						)}
						<Field hint="Give it a cool name." id="np-name" label="Project name">
							<input
								className={inputClass}
								id="np-name"
								onChange={e => setName(e.target.value)}
								placeholder={`My ${week.theme.toLowerCase()} project`}
								value={name}
							/>
						</Field>
						<Field hint="What's it gonna do?" id="np-desc" label="Project description">
							<textarea
								className={cx(inputClass, "resize-none")}
								id="np-desc"
								onChange={e => setDesc(e.target.value)}
								placeholder={selectedStarter ? selectedStarter.description : week.examples[0]}
								rows={3}
								value={desc}
							/>
						</Field>
						<RepoInput id="np-repo" onChange={setRepo} value={repo} />

						<div className="mt-2">
							<p className="label mb-2 text-violet-deep">Funding tier</p>
							{starterId !== null && (
								<p className="hand mb-2.5 text-[0.82rem] text-navy-soft">
									Starter projects are Tier 1. Switch to your own idea to choose a different tier.
								</p>
							)}
							{/* The hours quoted here are the funded block, which is exactly what the submit gate holds you to. The funded hours buy the parts; every hour past them earns spendable coins. */}
							<div className="grid gap-2.5">
								{TIERS.map(t => (
									<OptionRow
										disabled={starterId !== null && t.id !== STARTER_PROJECT_TIER}
										hint={
											<span className="text-navy-soft/90">
												You can submit on tier {t.id} from {fmtHours(t.fundingHours)} of design time, the parts-funding
												hours and nothing more. Every hour past that (once your tier&apos;s funding is achieved) earns 5
												spendable coins.
											</span>
										}
										key={t.id}
										onClick={() => setTier(t.id)}
										selected={tier === t.id}
									>
										<span className="flex flex-wrap items-baseline gap-x-2.5">
											<span className="text-[0.98rem] font-extrabold text-navy">Tier {t.id}</span>
											<span className="hand text-[0.86rem] text-teal-ink">${t.grantUsd} for parts</span>
											<span className="hand text-[0.8rem] text-navy-soft">
												· {fmtHours(submitFloorFor(t.fundingHours))} to submit
											</span>
										</span>
									</OptionRow>
								))}
							</div>
						</div>
					</div>

					<div className="order-first lg:order-none">
						<div className="overflow-hidden rounded-2xl p-4" style={{ background: week.accent }}>
							<WeekPainting
								className="sticker-shadow mx-auto aspect-square w-full max-w-55"
								sizes="(min-width: 1024px) 198px, 220px"
								theme={week.theme}
							/>
						</div>
						<p className="mt-3 text-[0.86rem] leading-snug text-navy-soft">{week.primer.split(". ")[0]}.</p>
					</div>
				</div>
			)}
		</Modal>
	)
}

/* ================================================================== *
 * Submit gate
 * ================================================================== */
/**
 * A Submit checkpoint whose week is already handed in and waiting for review.
 *
 * Opening it again is almost always "I need to change something", so it says where the week stands and offers the one thing that allows a change: taking it back out of review. Nothing is lost by it – the entries, parts list and details stay as they are, and this same checkpoint hands it in again.
 */
export function UnsubmitModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const { setOpenCheckpoint, unsubmitPhase, weekOfCheckpoint, stateOf } = useStore()
	const week = weekOfCheckpoint(checkpoint)
	const handedIn = stateOf(checkpoint.id).at
	const titleId = useId()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function unsubmit() {
		setBusy(true)
		setError(null)
		const refused = await unsubmitPhase(checkpoint.id)
		setBusy(false)
		if (refused) setError(refused)
		else setOpenCheckpoint(null)
	}

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow={`${weekName(week)} · ${checkpoint.title}`}
			footer={
				<>
					{error && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep" role="alert">
							{error}
						</p>
					)}
					<Button disabled={busy} onClick={() => setOpenCheckpoint(null)} variant="outline">
						Keep it in review
					</Button>
					<Button disabled={busy} onClick={() => unsubmit()} variant="solid">
						{busy ? "Unsubmitting…" : week.id === WARMUP_WEEK_ID ? "Unsubmit your warm-up" : `Unsubmit week ${week.id}`}
					</Button>
				</>
			}
			labelledBy={titleId}
			onClose={() => setOpenCheckpoint(null)}
			open
			size="md"
		>
			<ModalTitle
				id={titleId}
				sub={`${handedIn ? `Submitted ${formatShortDate(handedIn)}. ` : ""}Unsubmitting takes it out of the review queue so you can change your entries, parts list or project details. Submit it again from this checkpoint when you're done.`}
			>
				This week is waiting for review
			</ModalTitle>
		</Modal>
	)
}

export function SubmitModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const {
		setOpenCheckpoint,
		submitPhase,
		postReel,
		projects,
		setProjectTier,
		weekOfCheckpoint,
		hoursOf,
		printerFund,
		pendingCoins,
		goalId,
		setSharePost,
		statusOf,
	} = useStore()
	const week = weekOfCheckpoint(checkpoint)
	const isBuild = week.phase === "build"

	// The week is long enough to hand in – that gate is the trail's, and this node would be locked otherwise. What is left to say is whether it was long enough for the machine actually on the wall. A surplus earned in an earlier week pays for a thin one, so this reads the running total against the pace rather than this week against its target.
	//
	// The running total is the fund plus what unreviewed weeks will earn. Coins are minted at approval, so the fund alone reads this very week – the one being handed in, which nobody can have reviewed yet – as earning nothing, and warned everyone on every submit.
	const goal = printerById(goalId)
	const owed = Math.max(0, Math.ceil(paceTarget(goal, week.id) - printerFund - pendingCoins(week.id)))

	// The fallback is for a season sheet opened before its project row landed; it must never pick the warm-up project, which has no season week.
	const project =
		projects.find(p => isWeeksProject(week, p)) ?? projects.find(p => p.weekId !== WARMUP_WEEK_ID) ?? projects[0]
	// Handing a returned phase in again is a resubmission, and the budget rides on the project from the store. It is said here before the sheet is filled in, because the server refuses it either way and a maker deserves to know at the start rather than at the button.
	const resubmitting = statusOf(week) === "update_requested"
	const submissionsUsed = project?.submissions?.[week.phase] ?? 0
	const submissionsLeft = Math.max(0, SUBMISSION_LIMIT - submissionsUsed)
	const outOfSubmissions = resubmitting && submissionsLeft === 0

	const [step, setStep] = useState(1)
	// R2 object keys, not flags: what these ask for is evidence, and a boolean was letting the form take a file and drop it on the floor. Several screenshots, because one order is often split across vendors and one checkout page is not always one screen tall.
	const [carts, setCarts] = useState<UploadedImage[]>([])
	const [tier, setTier] = useState<1 | 2 | 3>(project?.tier ?? 1)
	// Makers who want nothing from the parts fund can hand in an empty BOM: the box states it, a confirm makes sure, and the flag is what lets the sheet past step 2 without carts.
	const [declinedFunding, setDeclinedFunding] = useState(false)
	// A cart past the tier's funding: the maker ticks this to say they will cover the shortfall themselves. Held in local state like the decline above, because it is a statement about this hand-in and the server re-reads the numbers before it believes it.
	const [acceptsPartialFunding, setAcceptsPartialFunding] = useState(false)
	// A Displays project can have no microcontroller, and so no firmware to hand in. This is the maker's confirmation of that; the server honours it only when firmware is the one check missing.
	const [noMicrocontroller, setNoMicrocontroller] = useState(false)
	const [clip, setClip] = useState<string | null>(null)
	// The bucket URL of the closing clip, when there is one, so it can be saved and posted elsewhere afterwards.
	const [clipUrl, setClipUrl] = useState<string | null>(null)
	// A blob URL for a locally picked clip holds the whole video in memory until it is revoked – the preview is replaced or the sheet closes, not before.
	useEffect(
		() => () => {
			if (clipUrl?.startsWith("blob:")) URL.revokeObjectURL(clipUrl)
		},
		[clipUrl],
	)
	// The closing reel once it is posted. A hand-in that fails after the reel went up reuses it on the retry rather than posting the same clip twice; a new clip clears it.
	const [closingPostId, setClosingPostId] = useState<string | null>(null)

	/**
	 * Stand in a closing reel from an earlier hand-in of this same week, picked back rather than filmed again.
	 *
	 * It fills the clip slot so the sheet's own gate is satisfied, and `closingPostId` is what keeps `submit` from posting it a second time – the reel the reviewer already has is the one this hand-in closes with.
	 */
	function reuseClosingReel(reel: SubmissionReel | null) {
		setClip(reel?.objectKey ?? null)
		setClipUrl(reel?.videoUrl ?? null)
		setClosingPostId(reel?.id ?? null)
	}
	// Handed in: the reel that closed the week is offered for posting online.
	const [works, setWorks] = useState<"yes" | "no" | null>(null)
	const [writeup, setWriteup] = useState("")
	// Null while checking. The server runs the same checks at submit, so this only decides whether the sheet lets you get that far.
	const [repoResult, setRepoResult] = useState<RepoCheckResult | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)

	// The closing reel is a reel like any other and goes on the trail under its own key, so the week's timeline shows it where it happened rather than swallowing it inside the submission.
	const reelCheckpointId = week.projectId ? `wu-${week.projectId}-reel-submission` : `w${week.id}-reel-submission`
	const closingSubject =
		week.id === WARMUP_WEEK_ID ? `Warm-up: ${project?.name ?? "my project"}` : `Week ${week.id}: ${week.theme}`
	const closingCaption = `${closingSubject} ${isBuild ? "built" : "designed"}.`
	const buildNotes = works === "no" && writeup.trim() ? writeup.trim() : undefined

	const total = isBuild ? 2 : 3
	// The project's own parts list, as kept on its page – read fresh when the sheet opens, because it is edited there and this is the moment it is handed in. Null while it loads; the cart total reads zero until then.
	const [bom, setBom] = useState<{ items: BomLine[]; taxShippingUsd: number } | null>(null)
	const [bomError, setBomError] = useState<string | null>(null)
	useEffect(() => {
		if (isBuild || !project) return
		let live = true
		void (async () => {
			try {
				const res = await fetch(`/api/projects/${project.id}/bom`, { cache: "no-store" })
				const payload: unknown = await res.json().catch(() => null)
				if (!res.ok) throw new Error(errorMessage(payload, refusalMessage(res.status, "Could not load the parts list")))
				const parsed = BomResponseSchema.safeParse(payload)
				if (!parsed.success) throw new Error("The parts list came back unreadable. Try again.")
				if (live) setBom({ items: parsed.data.items, taxShippingUsd: parsed.data.taxShippingUsd })
			} catch (err) {
				if (live) setBomError(err instanceof Error ? err.message : String(err))
			}
		})()
		return () => {
			live = false
		}
	}, [isBuild, project?.id]) // the id is the input
	// The same arithmetic the submit gate reads (lib/bom-policy), so the total on screen is the total being held to.
	const bomTotal = useMemo(() => bomTotalUsd(bom?.items ?? [], bom?.taxShippingUsd), [bom])

	/**
	 * A tier is a claim about hours as much as about money: its funded block has to be covered, and everything past it earns. Tier 2 funds thirteen hours, so thirteen hours pay for the project and the fourteenth already earns – which is why the tier cannot be raised at the last moment on hours that were only ever enough for a smaller one.
	 *
	 * Two asks come out of that, and they are different numbers. The floor is the funded block, and below it the week cannot be handed in at all, so it is a gate. The target is this maker's own goal, and it moves when they change what they are saving for – a P1S asks far more of a tier 2 week than an Ender does. Missing the target is a warning the sheet already gives; missing the floor is a refusal.
	 */
	const hours = hoursOf(week)
	const tierFloor = submitFloorFor
	const tierShort = (fundingHours: number) => Math.max(0, tierFloor(fundingHours) - hours)
	const selectedTier = getTier(tier) ?? ENTRY_TIER
	const tierBlocked = !isBuild && tierShort(selectedTier.fundingHours) > 0
	// Over the tier's funding warns; past the leeway the grant covers only part of the cart, which is allowed but has to be agreed to rather than discovered at review.
	const funding = partsFunding(bomTotal, selectedTier.grantUsd)
	const bomOverCap = !isBuild && funding.needsAgreement
	// No BOM, no carts, no order: declining funding is how an empty parts list hands in. Read off the loaded list every render rather than trusted from the toggle alone, so a stale flag can never unblock a week whose parts arrived after the box was ticked.
	const bomEmpty = !isBuild && bom !== null && bom.items.length === 0
	// Declining is a stated preference, not a reading of the list: it holds with parts or without, and only while the list has loaded – unticked until the box is actually on screen.
	const fundingDeclined = !isBuild && declinedFunding && bom !== null
	// Same reading for the partial-funding box: honoured only while the cart is actually over, so raising the tier or editing the parts list back under it retires the tick on its own. Declining wins over agreeing: no funding means nothing to agree to.
	const partialFunding = bomOverCap && acceptsPartialFunding && !fundingDeclined
	// The gate needs the agreement only when there is something to agree to: under budget there is nothing, and declined means no grant at all.
	const fundingOk = fundingDeclined || !bomOverCap || acceptsPartialFunding

	// The Displays week requires firmware, but a project with no microcontroller has none to give. That check is waivable only when it is the one thing missing; every other blocking failure still holds the sheet.
	const firmwareMissing =
		week.theme === "Displays"
		&& (repoResult?.checks.some(check => check.key === "firmware" && check.blocking && check.status === "fail")
			?? false)
	const otherRepoBlocker =
		repoResult?.checks.some(check => check.blocking && check.status === "fail" && check.key !== "firmware") ?? false
	const repoReady = (repoResult?.canSubmit ?? false) || (firmwareMissing && !otherRepoBlocker && noMicrocontroller)

	const hasCover = Boolean(project?.coverImageKey)
	const descriptionLength = project?.description.trim().length ?? 0
	const descriptionReady = descriptionLength >= MIN_PROJECT_DESCRIPTION_CHARS
	const descriptionBlocker = `Write at least ${MIN_PROJECT_DESCRIPTION_CHARS} characters about your project before submitting. You have ${descriptionLength}.`
	// A starter's description is written into the project when it is taken. The server refuses it; the sheet says so before the button is pressed, so the maker fixes it where the field is.
	const starterDescriptionReady = !usesStarterDefaultDescription(
		project?.starterProjectId ?? null,
		project?.description ?? null,
	)
	const starterDescriptionBlocker =
		"Replace the starter project's default description with your own. Say what you changed, why you made it, and what makes it yours."

	const canAdvance =
		step === 1
			? repoReady
			: isBuild
				? clip
					&& descriptionReady
					&& starterDescriptionReady
					&& !outOfSubmissions
					&& (works === "yes" || (works === "no" && writeup.trim().length >= 40))
				: step === 2
					? // No funding, no order, no carts to screenshot: a declined empty BOM carries no cart evidence.
						(carts.length > 0 || fundingDeclined) && !tierBlocked && fundingOk
					: clip
						&& !tierBlocked
						&& fundingOk
						&& hasCover
						&& descriptionReady
						&& starterDescriptionReady
						&& !outOfSubmissions

	/**
	 * Why the button at the foot is greyed, in the maker's terms, or null when it is live.
	 *
	 * The button has always been disabled for exactly these reasons; what it never did was say which one was in the way, so a maker missing a cart screenshot met a dead Next with nothing on screen to explain it. The branches mirror `canAdvance` above step for step – a line here while the button is live would be worse than the silence it replaced.
	 *
	 * Step 1 keeps its own pair of lines at the foot: the repo check has a "still running" state the others do not. The cover banner at the top of the body is repeated here on purpose – it is a long scroll away from the button it blocks.
	 */
	function nextBlocker(): string | null {
		if (step === 1) return null
		if (outOfSubmissions)
			return `All ${SUBMISSION_LIMIT} submissions for this phase are used. Dispute the review or ask a reviewer in Slack.`
		// These two block whichever of the later steps is showing.
		if (tierBlocked)
			return `Your tier needs ${fmtHours(tierShort(selectedTier.fundingHours))} more design time than you have logged this week. Pick a tier you have earned.`
		if (!fundingOk) return "Tick the box agreeing to cover the part of the cart the grant does not."
		if (isBuild)
			return !clip
				? "Record your demo video to carry on."
				: works === "no" && writeup.trim().length < 40
					? "Say what needs to change in a sentence or two."
					: !descriptionReady
						? descriptionBlocker
						: !starterDescriptionReady
							? starterDescriptionBlocker
							: null
		if (step === 2)
			return carts.length === 0 && !fundingDeclined ? "Add a screenshot of your cart above to carry on." : null
		if (!clip) return "Record your closing reel to carry on."
		if (!hasCover) return "Add a cover image to your project before you can submit."
		if (!descriptionReady) return descriptionBlocker
		if (!starterDescriptionReady) return starterDescriptionBlocker
		return null
	}

	/**
	 * Handing a week in, in the order the pieces depend on each other.
	 *
	 * The tier first, because it is what the reviewer will be deciding against. Then the closing reel, awaited, so the submission a reviewer opens – and the YSWS row written just after it, which looks the reel up – already has the video rather than one arriving behind it. It is posted once: a retry after a refused hand-in reuses it. The submission last, and only once it has gone through is the reel offered for posting online.
	 */
	async function submit() {
		if (submitting) return
		setSubmitting(true)
		setSubmitError(null)
		if (project) setProjectTier(project.id, tier)
		let postId = closingPostId
		if (clip && !postId) {
			const posted = await postReel(reelCheckpointId, closingCaption, clip)
			// The button already refuses to submit without a clip, so a closing reel that did not land is the same situation and stops here too: handing the week in without it would leave a reviewer a submission with no video and the maker none the wiser.
			if (posted.error) {
				setSubmitting(false)
				setSubmitError(posted.error)
				return
			}
			postId = posted.postId ?? null
			setClosingPostId(postId)
		}
		const refused = await submitPhase(checkpoint.id, {
			attachmentKeys: carts.map(c => c.objectKey),
			fundingDeclined,
			noMicrocontroller: firmwareMissing && noMicrocontroller,
			notes: isBuild ? buildNotes : undefined,
			partialFundingAccepted: partialFunding,
		})
		setSubmitting(false)
		if (refused) {
			setSubmitError(refused)
			return
		}
		// Into the store rather than local state: the refresh this triggers flips the week to in_review, and the checkpoint router shows the celebration from there so it survives.
		if (postId)
			setSharePost({
				// Design only: build weeks earn flat, so "past your tier" means nothing there. The hours are the week's own total – the same basis the sheet's floor and target read – though a reviewer can still adjust them.
				celebration: !isBuild ? { extraHours: Math.max(0, hours - week.earnFrom) } : undefined,
				checkpointId: checkpoint.id,
				eyebrow: `${weekName(week)} · Submitted`,
				postId,
				videoUrl: clipUrl,
			})
		else setOpenCheckpoint(null)
	}

	// Declining funding is the one choice in this sheet that an edit cannot quietly undo – once handed in without it there is no grant to order – so the box asks once more, following the repo's window.confirm precedent for irreversible choices.
	function toggleDeclinedFunding() {
		if (declinedFunding) {
			setDeclinedFunding(false)
			return
		}
		if (
			window.confirm(
				bomEmpty
					? "Submit with an empty parts list? No parts funding will be ordered for this project. You can still change your mind before you submit."
					: "Submit without any parts funding? Your parts list stays on the project for the reviewer to see, but approving it orders no grant. You can still change your mind before you submit.",
			)
		) {
			setDeclinedFunding(true)
			setAcceptsPartialFunding(false)
		}
	}

	return (
		<Modal
			accent="var(--color-magenta)"
			eyebrow={`Submit ${week.id === WARMUP_WEEK_ID ? "your warm-up" : `week ${week.id}`} · ${step}/${total}`}
			footer={
				<>
					<Button onClick={() => (step === 1 ? setOpenCheckpoint(null) : setStep(s => s - 1))} variant="outline">
						{step === 1 ? "Not yet" : "Back"}
					</Button>
					{submitError && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
							{submitError}
						</p>
					)}
					{step === 1 && !submitError && !repoReady && repoResult && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep">
							{firmwareMissing && !otherRepoBlocker
								? "Tick the box above if your project has no microcontroller, or add its firmware."
								: "Fix the repo checks above to carry on."}
						</p>
					)}
					{step === 1 && !submitError && !repoReady && repoResult === null && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-navy-soft" role="status">
							Checking your repo…
						</p>
					)}
					{step > 1 && !submitError && nextBlocker() && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
							{nextBlocker()}
						</p>
					)}
					{step < total ? (
						<Button disabled={!canAdvance} onClick={() => setStep(s => s + 1)} variant="solid">
							Next <IconArrowRight className="text-base" />
						</Button>
					) : (
						<Button disabled={!canAdvance || submitting} onClick={() => submit()} variant="coral">
							{submitting
								? "Submitting…"
								: owed > 0
									? "Submit anyway"
									: week.id === WARMUP_WEEK_ID
										? "Submit warm-up"
										: `Submit week ${week.id}`}{" "}
							<IconCheck className="text-base" />
						</Button>
					)}
				</>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			scrollKey={step}
			size="lg"
		>
			{resubmitting && (
				<div
					className={cx(
						"sketch mb-5 flex items-start gap-3 rounded-2xl px-5 py-4",
						outOfSubmissions ? "bg-coral/10" : "bg-gold-pale/70",
					)}
					style={{
						"--sk-color": outOfSubmissions ? "var(--color-coral)" : "var(--color-gold-deep)",
						"--sk-radius": "16px",
					}}
				>
					<IconWarning
						className={cx("mt-0.5 shrink-0 text-xl", outOfSubmissions ? "text-coral-deep" : "text-gold-ink")}
					/>
					<div className="min-w-0">
						<p
							className={cx(
								"text-[0.95rem] leading-snug font-extrabold",
								outOfSubmissions ? "text-coral-dark" : "text-navy",
							)}
						>
							{outOfSubmissions
								? `All ${SUBMISSION_LIMIT} submissions for this phase are used.`
								: `Submission ${submissionsUsed + 1} of ${SUBMISSION_LIMIT} for this phase`}
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							{outOfSubmissions
								? "It stays returned for now. Dispute the review or ask a reviewer in Slack; you cannot submit it again. "
								: submissionsLeft === 1
									? "This is your last one. If it comes back needing changes again, you cannot submit it. "
									: `${submissionsLeft - 1} left after this one. `}
							{project && (
								<Link
									className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
									href={`/projects/${project.id}`}
									onClick={() => setOpenCheckpoint(null)}
								>
									Go to project page
								</Link>
							)}
						</p>
					</div>
				</div>
			)}

			{/* On every step, not just the last one: a maker who is short on hours should find that out before working through the checklist, not after. It warns and does not block – the hours needed for a printer at all are the trail's gate, and this is the gap to the one they chose. */}
			{!hasCover && (
				<div
					className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
					style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" }}
				>
					<IconCamera className="mt-0.5 shrink-0 text-xl text-coral-deep" />
					<div className="min-w-0">
						<p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
							{project ? `${project.name} needs a cover image.` : "Your project needs a cover image."}
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							Upload a photo or screenshot of the project on that project&apos;s page before you can submit. Covers are
							per project, so a cover uploaded elsewhere does not count.{" "}
							{project && (
								<Link
									className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
									href={`/projects/${project.id}`}
									onClick={() => setOpenCheckpoint(null)}
								>
									Go to project page
								</Link>
							)}
						</p>
					</div>
				</div>
			)}

			{!descriptionReady && (
				<div
					className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
					style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" }}
				>
					<IconPencil className="mt-0.5 shrink-0 text-xl text-coral-deep" />
					<div className="min-w-0">
						<p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
							{project ? `${project.name} needs a longer description.` : "Your project needs a longer description."}
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							A reviewer decides from the description, so it needs at least {MIN_PROJECT_DESCRIPTION_CHARS} characters.
							You have {descriptionLength}.{" "}
							{project && (
								<Link
									className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
									href={`/projects/${project.id}`}
									onClick={() => setOpenCheckpoint(null)}
								>
									Edit the description
								</Link>
							)}
						</p>
					</div>
				</div>
			)}

			{!starterDescriptionReady && (
				<div
					className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
					style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" }}
				>
					<IconPencil className="mt-0.5 shrink-0 text-xl text-coral-deep" />
					<div className="min-w-0">
						<p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
							{project
								? `${project.name} still has the starter's description.`
								: "This project still has the starter's description."}
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							Write your own description. Say what you changed, why you made it, and what makes it yours.{" "}
							{project && (
								<Link
									className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
									href={`/projects/${project.id}`}
									onClick={() => setOpenCheckpoint(null)}
								>
									Edit the description
								</Link>
							)}
						</p>
					</div>
				</div>
			)}

			{owed > 0 && (
				<div
					className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
					style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" }}
				>
					<IconWarning className="mt-0.5 shrink-0 text-xl text-coral-deep" />
					<div className="min-w-0">
						<p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
							You&apos;re a little behind on your printer goal.
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							Spend some more time on it! You are <span className="font-bold text-navy tabular-nums">{owed}</span>{" "}
							{owed === 1 ? "coin" : "coins"} behind the pace for a{" "}
							<span className="font-bold text-navy">{goal.name}</span>. You can still submit it, and a bigger week later
							makes it up.
						</p>
					</div>
				</div>
			)}

			{step === 1 && (
				<div>
					<ModalTitle
						sub={
							isBuild
								? "Reviewers watch the demo first and read everything else second. Get the video right."
								: "Source files, not exports. A PDF of a schematic is not a schematic."
						}
					>
						Check all files are included
					</ModalTitle>
					{project && (
						<RepoChecks
							onResult={setRepoResult}
							project={project}
							waivedFirmware={firmwareMissing && noMicrocontroller}
						/>
					)}
					{/* The Displays week asks for firmware because most display projects drive one from a microcontroller. Some do not, and have no firmware to give: the box is the maker's confirmation, and it takes only that check off the gate. */}
					{firmwareMissing && (
						<label
							className={cx(
								"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
								noMicrocontroller ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
							)}
							style={{
								"--sk-color": noMicrocontroller ? "var(--color-violet)" : "var(--color-line)",
								"--sk-radius": "16px",
							}}
						>
							<input
								checked={noMicrocontroller}
								className="sr-only"
								onChange={() => setNoMicrocontroller(value => !value)}
								type="checkbox"
							/>
							<span
								aria-hidden="true"
								className={cx(
									"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
									noMicrocontroller ? "border-transparent bg-violet" : "border-line-strong",
								)}
							>
								{noMicrocontroller && <IconCheck className="text-sm text-white" />}
							</span>
							<span className="min-w-0">
								<span className="block text-[0.95rem] font-extrabold text-navy">My project has no microcontroller</span>
								<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
									There is no firmware to include. Tick this to hand the week in without it; a reviewer will see what
									drives the display instead.
								</span>
							</span>
						</label>
					)}
				</div>
			)}

			{!isBuild && step === 2 && (
				<div>
					<ModalTitle
						sub={
							fundingDeclined
								? "No parts, no order. Just the tier your hours unlock."
								: "Every line needs a real vendor and a real price. We ask for the cart screenshot so the total is checkable."
						}
					>
						{fundingDeclined ? "Finalise your tier" : "Finalise your BOM and tier"}
					</ModalTitle>

					{/* Declined funding hides the parts list and its edit note – there is nothing to check. */}
					{!fundingDeclined && (
						<>
							<Panel className="overflow-hidden bg-white" radius={18} tone="line">
								{bomError ? (
									<p className="px-4 py-5 text-[0.86rem] font-semibold text-coral-deep" role="alert">
										{bomError}
									</p>
								) : !bom ? (
									<p aria-live="polite" className="hand px-4 py-5 text-[0.88rem] text-navy-soft">
										reading your parts list…
									</p>
								) : (
									<div className="overflow-x-auto">
										<table className="w-full min-w-120 text-left text-[0.86rem]">
											<thead>
												<tr className="border-b border-dashed border-line">
													{["Part", "Qty", "Unit", "Total", "Vendor"].map(h => (
														<th className="label px-4 py-2.5 text-navy-soft" key={h} scope="col">
															{h}
														</th>
													))}
												</tr>
											</thead>
											<tbody>
												{bom.items.length === 0 && (
													<tr className="border-b border-dashed border-line/60">
														<td className="hand px-4 py-3.5 text-[0.88rem] text-coral-deep" colSpan={5}>
															no parts listed yet. Add them on the project page (or decline funding below) before you
															submit this.
														</td>
													</tr>
												)}
												{bom.items.map(l => (
													<tr className="border-b border-dashed border-line/60 align-top" key={l.id}>
														<td className="px-4 py-2.5">
															<span className="block font-semibold [overflow-wrap:anywhere] text-navy">{l.name}</span>
															{l.purpose && (
																<span className="block text-[0.8rem] leading-snug text-navy-soft">{l.purpose}</span>
															)}
														</td>
														<td className="px-4 py-2.5 tabular-nums">{l.quantity}</td>
														<td className="px-4 py-2.5 tabular-nums">${l.unitCostUsd.toFixed(2)}</td>
														<td className="px-4 py-2.5 font-semibold text-navy tabular-nums">
															${(l.quantity * l.unitCostUsd).toFixed(2)}
														</td>
														<td className="hand px-4 py-2.5 text-navy-soft">
															{l.link ? (
																<a
																	className="underline decoration-line-strong underline-offset-4 hover:text-navy"
																	href={l.link}
																	rel="noopener noreferrer"
																	target="_blank"
																>
																	{l.vendor || "link"}
																</a>
															) : (
																l.vendor || "-"
															)}
														</td>
													</tr>
												))}
												<tr>
													<td className="px-4 py-2.5">
														<span className="block font-semibold text-navy">Tax &amp; shipping</span>
														<span className="block text-[0.8rem] leading-snug text-navy-soft">for the whole order</span>
													</td>
													<td className="px-4 py-2.5 text-navy-soft">-</td>
													<td className="px-4 py-2.5 text-navy-soft">-</td>
													<td className="px-4 py-2.5 font-semibold text-navy tabular-nums">
														${bom.taxShippingUsd.toFixed(2)}
													</td>
													<td />
												</tr>
											</tbody>
										</table>
									</div>
								)}
								<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-cream px-4 py-3">
									<span className="label text-navy-soft">Cart total</span>
									<span className="text-[1.05rem] font-extrabold text-navy tabular-nums">${bomTotal.toFixed(2)}</span>
								</div>
							</Panel>
							{/* One place to change the list: the project page. The sheet reads it, so what is handed in is what the maker kept there. */}
							{project && (
								<p className="hand mt-2 text-[0.82rem] text-navy-soft">
									Something wrong?{" "}
									<Link
										className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
										href={`/projects/${project.id}#bom-title`}
										onClick={() => setOpenCheckpoint(null)}
									>
										Edit the parts list on the project page
									</Link>
									.
								</p>
							)}
						</>
					)}
					{/* Already stocked, or building from scrap: declining funding hands the week in with no grant and no order. An empty BOM needs it; a stocked one takes it as a choice. */}
					{!isBuild && bom !== null && (
						<label
							className={cx(
								"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
								declinedFunding ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
							)}
							style={{
								"--sk-color": declinedFunding ? "var(--color-violet)" : "var(--color-line)",
								"--sk-radius": "16px",
							}}
						>
							<input checked={declinedFunding} className="sr-only" onChange={toggleDeclinedFunding} type="checkbox" />
							<span
								aria-hidden="true"
								className={cx(
									"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
									declinedFunding ? "border-transparent bg-violet" : "border-line-strong",
								)}
							>
								{declinedFunding && <IconCheck className="text-sm text-white" />}
							</span>
							<span className="min-w-0">
								<span className="block text-[0.95rem] font-extrabold text-navy">
									I don&apos;t want parts funding for this project
								</span>
								<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
									{bomEmpty
										? "Submit with an empty parts list. No carts, no order. We'll double-check before you submit."
										: "Your parts list stays for the reviewer to see, but approving it orders no grant, so fund the build yourself. We'll double-check before you submit."}
								</span>
							</span>
						</label>
					)}

					{/* No order, nothing to screenshot: the carts go away with the BOM. */}
					{!fundingDeclined && (
						<div className="mt-8 border-t border-dashed border-line pt-6">
							<div className="grid gap-2">
								<p className="label flex items-center gap-2 text-navy-soft">
									<IconCart className="text-base" /> Screenshots of your cart
								</p>
								<p className="text-[0.88rem] leading-snug text-navy-soft">
									The checkout page with the total visible. Any vendor works. Add one per cart if the order is split.
								</p>
								<ImageUploads folder="sessions" images={carts} label="Cart screenshot" max={10} onChange={setCarts} />
								{/* The gate below is `carts.length > 0`, and until now nothing on screen said so: the Next button simply stayed grey. Named here, next to the box that clears it. */}
								{carts.length === 0 && (
									<p className="mt-1 flex items-start gap-1.5 text-[0.84rem] leading-snug text-coral-deep">
										<IconWarning className="mt-0.5 shrink-0 text-sm" />
										<span>
											At least one cart screenshot is needed before you can carry on. It is what the parts total is
											checked against. One per cart if the order is split across vendors.
										</span>
									</p>
								)}
							</div>
						</div>
					)}

					<div className="mt-8 border-t border-dashed border-line pt-6">
						<p className="label mb-2 text-magenta">Finalise your tier</p>
						<p className="mb-3 text-[0.82rem] leading-snug text-navy-soft">
							Find out which tier you&apos;re eligible for! Your current goal is a{" "}
							<span className="font-bold text-navy">{goal.name}</span> and you have{" "}
							<span className="font-bold text-navy tabular-nums">{fmtHours(hours)}</span> logged this week.
						</p>
						<div className="grid gap-2.5 sm:grid-cols-3">
							{TIERS.map(t => {
								const on = tier === t.id
								const over = bomTotal > t.grantUsd
								const short = tierShort(t.fundingHours)
								return (
									<button
										aria-pressed={on}
										className={cx(
											"sketch rounded-2xl px-4 py-3 text-left transition-colors",
											short > 0
												? "cursor-not-allowed bg-black/[.03]"
												: on
													? "bg-violet-pale"
													: "bg-white hover:bg-black/[.03]",
										)}
										// A tier you have not worked the hours for is not an option, so it does not behave like one.
										disabled={short > 0}
										key={t.id}
										onClick={() => setTier(t.id)}
										style={{
											"--sk-color": on ? "var(--color-violet)" : "var(--color-line)",
											"--sk-radius": "16px",
										}}
										type="button"
									>
										<span
											className={cx("block text-[0.95rem] font-extrabold", short > 0 ? "text-navy-soft" : "text-navy")}
										>
											Tier {t.id}
										</span>
										<span className={cx("hand block text-[0.86rem]", short > 0 ? "text-navy-soft" : "text-teal-ink")}>
											${t.grantUsd} for parts
										</span>

										{/* The hours are the gate, so they lead. The cart only says whether the money fits inside the tier once the tier is actually available to you. */}
										<span
											className={cx(
												"mt-1 block text-[0.76rem] leading-snug",
												short > 0 ? "text-coral-deep" : "text-navy-soft",
											)}
										>
											{short > 0
												? `Opens at ${fmtHours(tierFloor(t.fundingHours))} of design time, ${fmtHours(short)} to go`
												: `Every hour past this tier's ${t.fundingHours}h earns 5 spendable coins`}
										</span>
										{short === 0 && over && (
											<span className="hand mt-1 block text-[0.74rem] leading-snug text-coral-deep">
												{bomTotal > t.grantUsd + BOM_MARGIN_USD
													? `Cart over by $${(bomTotal - t.grantUsd).toFixed(2)}, so only $${t.grantUsd} of it is funded and you have to agree to that below`
													: `Cart over by $${(bomTotal - t.grantUsd).toFixed(2)}, but within the $${BOM_MARGIN_USD} margin, so you can still submit`}
											</span>
										)}
									</button>
								)
							})}
						</div>

						{/* A cart past the tier's funding still hands in, as a grant that covers part of it – so the box saying so is a requirement rather than a note, and the shortfall is named in dollars rather than left to be found later. It sits under the tier picker because it is that choice it is about, and it disappears the moment a tier that covers the cart is picked. */}
						{bomOverCap && (
							<label
								className={cx(
									"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
									partialFunding ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
								)}
								style={{
									"--sk-color": partialFunding ? "var(--color-violet)" : "var(--color-line)",
									"--sk-radius": "16px",
								}}
							>
								<input
									checked={partialFunding}
									className="sr-only"
									onChange={e => {
										setAcceptsPartialFunding(e.target.checked)
										if (e.target.checked) setDeclinedFunding(false)
									}}
									type="checkbox"
								/>
								<span
									aria-hidden="true"
									className={cx(
										"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
										partialFunding ? "border-transparent bg-violet" : "border-line-strong",
									)}
								>
									{partialFunding && <IconCheck className="text-sm text-white" />}
								</span>
								<span className="min-w-0">
									<span className="block text-[0.95rem] font-extrabold text-navy">
										I understand this project gets partial funding
									</span>
									<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
										Your parts list is ${funding.totalUsd.toFixed(2)} and {selectedTier.name} funds $
										{selectedTier.grantUsd}, so ${funding.shortfallUsd.toFixed(2)} of it is yours to pay. Tick this to
										hand the week in anyway. A reviewer can still move you up a tier, but that shortfall is yours unless
										they do.
									</span>
								</span>
							</label>
						)}
					</div>
				</div>
			)}

			{((isBuild && step === 2) || (!isBuild && step === 3)) && (
				<div>
					<ModalTitle
						sub={
							isBuild
								? "Thirty to sixty seconds of the project working, with your voice explaining what it does."
								: "One last reel walking through the finished design. Thirty seconds is plenty."
						}
					>
						{isBuild ? "Show it working" : "Final submission reel"}
					</ModalTitle>

					<div className="grid gap-2">
						<p className="label flex items-center gap-2 text-navy-soft">
							<IconCamera className="text-base" /> {isBuild ? "Your demo video" : "Your closing reel"}
						</p>
						<p className="text-[0.88rem] leading-snug text-navy-soft">
							{isBuild
								? "Point the camera at the thing, turn it on, and talk over it."
								: "Pan across the schematic, the layout, and the render."}
						</p>
						<ReelCapture
							objectKey={clip}
							onCaptured={(key, url) => {
								setClip(key)
								setClipUrl(url ?? null)
								setClosingPostId(null)
							}}
						/>
					</div>

					<SubmissionReelPicker
						checkpointKey={reelCheckpointId}
						onSelect={reuseClosingReel}
						selectedId={closingPostId}
					/>

					{isBuild && (
						<div className="mt-6">
							<p className="label mb-2 text-magenta">Does it work?</p>
							<div className="grid gap-2.5 sm:grid-cols-2">
								<OptionRow onClick={() => setWorks("yes")} selected={works === "yes"}>
									<span className="text-[0.95rem] font-bold text-navy">Yes, it does the thing</span>
								</OptionRow>
								<OptionRow onClick={() => setWorks("no")} selected={works === "no"}>
									<span className="text-[0.95rem] font-bold text-navy">Not yet</span>
								</OptionRow>
							</div>

							{works === "no" && (
								<div className="mt-4">
									<Field
										hint="Reviewers pass honest failures and fail silent ones. Say what you would do next."
										id="writeup"
										label="What needs to change"
									>
										<textarea
											className={cx(inputClass, "resize-none")}
											id="writeup"
											onChange={e => setWriteup(e.target.value)}
											placeholder="The display initialises but stays blank. I think the reset pin is floating, so next revision ties it through a 10k to 3V3 and I will bodge it in the meantime."
											rows={5}
											value={writeup}
										/>
									</Field>
									<p
										className={cx(
											"hand mt-1.5 text-right text-[0.76rem] tabular-nums",
											writeup.trim().length >= 40 ? "text-teal-ink" : "text-navy-soft",
										)}
									>
										{writeup.trim().length} / 40 characters
									</p>
								</div>
							)}
						</div>
					)}

					<div className="mt-6 flex flex-wrap items-center gap-2.5">
						<Chip tone="teal">
							<IconCheck className="text-[0.9rem]" /> Files attached
						</Chip>
						{!isBuild && (
							<Chip tone="teal">
								<IconCheck className="text-[0.9rem]" /> BOM ${bomTotal.toFixed(2)} · tier {tier}
							</Chip>
						)}
						<Chip tone={clip ? "teal" : "muted"}>
							{clip ? <IconCheck className="text-[0.9rem]" /> : <IconFilm className="text-[0.9rem]" />}{" "}
							{clip ? "Video attached" : "Video missing"}
						</Chip>
					</div>
				</div>
			)}
		</Modal>
	)
}
