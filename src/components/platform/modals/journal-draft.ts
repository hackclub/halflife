import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react"
import type { LapseTimelapse } from "@/lib/lapse-timelapses"
import { round2 } from "@/lib/money"
import type { SessionLog } from "@/lib/types"
import {
	clampToContentLimit,
	cleanBodyForAutosave,
	clearJournalAutosave,
	draftKey,
	LapseResolveBodySchema,
	peekJournalTrip,
	readJournalAutosave,
	writeJournalAutosave,
} from "./checkpoint-shared"

type JournalTab = "journal" | "timelapse"

interface ClipSeed {
	picked: LapseTimelapse[]
	pinned: string[]
}

export interface JournalDraft {
	baselineBody: string
	baselineHours: string
	body: string
	clearDraft(): void
	clipSeed: ClipSeed
	clipsTouchedRef: { current: boolean }
	discardDraft(): void
	draftRestored: boolean
	editing: boolean
	hasUnsavedWork: boolean
	hoursText: string
	legacyBump: { from: number; lapse: number } | null
	legacyKept: string[]
	picked: LapseTimelapse[]
	pinned: string[]
	preview: boolean
	setBody: Dispatch<SetStateAction<string>>
	setHoursText: Dispatch<SetStateAction<string>>
	setLegacyKept: Dispatch<SetStateAction<string[]>>
	setPicked: Dispatch<SetStateAction<LapseTimelapse[]>>
	setPinned: Dispatch<SetStateAction<string[]>>
	setPreview: Dispatch<SetStateAction<boolean>>
	setTab: Dispatch<SetStateAction<JournalTab>>
	tab: JournalTab
}

/**
 * The sheet's working copy: the words, the hours, the clips, and the browser's copy of them.
 *
 * A Lapse sign-in leaves the page and comes back: that trip's draft is restored once. Anything else typed is autosaved to this browser and restored next time the sheet opens, so clicking out cannot lose it. A saved entry clears it.
 */
export function useJournalDraft(checkpointId: string, existing: SessionLog | undefined): JournalDraft {
	const editing = existing !== undefined

	// Peeked (not taken) during render so StrictMode's double-invoked initializer cannot consume it before state is set.
	// oxlint-disable-next-line react/hook-use-state
	const [draft] = useState(() => peekJournalTrip(checkpointId) ?? readJournalAutosave(checkpointId))
	const draftRestored = draft != null

	// An edit re-opens the picker with this entry's clips selected: Lapse clips that still verify resolve into items, ones Lapse no longer vouches for stay pinned by id, and older non-Lapse uploads stay untouched. The resolve below seeds all three; a returning draft already holds the working set.
	const [picked, setPicked] = useState<LapseTimelapse[]>(draft?.picked ?? [])
	const [pinned, setPinned] = useState<string[]>(draft?.pinned ?? [])
	const [legacyKept, setLegacyKept] = useState<string[]>(draft?.legacy ?? [])
	// The last-saved clip set, for telling a real change from the seed – and for putting the seed back on "Discard draft".
	const [clipSeed, setClipSeed] = useState<ClipSeed>({ picked: [], pinned: [] })
	// Resolve runs once per open; anything the maker toggles after that wins over the seed, whenever it lands.
	const seededRef = useRef(false)
	const clipsTouchedRef = useRef(
		(draft?.picked.length ?? 0) > 0 || (draft?.pinned?.length ?? 0) > 0 || (draft?.legacy?.length ?? 0) > 0,
	)

	const [tab, setTab] = useState<JournalTab>(editing ? "journal" : (draft?.tab ?? "journal"))
	// A draft is cut to the box's own ceiling: autosave wrote whatever was typed, including entries past a limit the server refuses, so a draft from before `maxLength` existed restores to something that can be typed on and saved. The saved entry is not cut, because it came from the server and is already within bounds.
	const [body, setBody] = useState(draft ? clampToContentLimit(draft.body) : (existing?.body ?? ""))
	const [preview, setPreview] = useState(false)
	// Free text, not a number: a controlled number input that coerces as you type eats the decimal point the moment you reach for "1.5".
	const [hoursText, setHoursText] = useState(
		draft?.hoursText ?? (existing ? String(round2(existing.minutes / 60)) : ""),
	)
	// Autosave: every keystroke lands in this browser, so closing the sheet, reloading, or navigating away cannot lose it. Empty sheets and edits matching the saved entry keep no draft; a saved entry clears it.
	const baselineBody = existing?.body ?? ""
	// In the box's own arithmetic, once the seed below restates it: the box holds what the timelapses do not cover, so the baseline moves with it.
	const [baselineHours, setBaselineHours] = useState(existing ? String(round2(existing.minutes / 60)) : "")
	// An entry logged under the old arithmetic whose old total does not cover its resolved timelapses: restating the box clamps it at zero and the total grows on open. Named on screen rather than silently absorbed, so a typo fix never quietly logs extra hours.
	const [legacyBump, setLegacyBump] = useState<{ from: number; lapse: number } | null>(null)

	// The trip draft has been restored into state: consume it so it cannot resurrect an entry days later. Autosave below keeps it from here on.
	useEffect(() => {
		try {
			window.sessionStorage.removeItem(draftKey(checkpointId))
		} catch {
			// Storage off.
		}
	}, [checkpointId])

	// Seed the picker's working set from what the entry was saved with. The seed never overwrites anything already picked – a returning draft, or a toggle that beat the read back, always wins.
	useEffect(() => {
		if (!editing || !existing || existing.clips.length === 0 || seededRef.current) return
		let live = true
		void (async () => {
			let seed: ClipSeed = { picked: [], pinned: [] }
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
	}, [editing, existing, checkpointId])

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
			writeJournalAutosave(checkpointId, null)
			return
		}
		writeJournalAutosave(checkpointId, { body: cleanBody, hoursText, legacy: legacyKept, picked, pinned, tab })
	}, [checkpointId, tab, body, hoursText, picked, pinned, legacyKept, clipSeed, editing, baselineBody, baselineHours])

	const hasUnsavedWork =
		cleanBodyForAutosave(body).trim() !== "" || hoursText.trim() !== "" || picked.length > 0 || pinned.length > 0

	function clearDraft() {
		clearJournalAutosave(checkpointId)
	}

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
		writeJournalAutosave(checkpointId, null)
	}

	return {
		baselineBody,
		baselineHours,
		body,
		clearDraft,
		clipSeed,
		clipsTouchedRef,
		discardDraft,
		draftRestored,
		editing,
		hasUnsavedWork,
		hoursText,
		legacyBump,
		legacyKept,
		picked,
		pinned,
		preview,
		setBody,
		setHoursText,
		setLegacyKept,
		setPicked,
		setPinned,
		setPreview,
		setTab,
		tab,
	}
}
