"use client"
import type { ReactNode } from "react"
import { z } from "zod"
import { IconCheck } from "@/components/platform/icons"
import { errorMessage } from "@/lib/api-error"
import { BomLineSchema } from "@/lib/bom-schema"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { cx } from "@/lib/cx"
import { LapseTimelapseSchema } from "@/lib/lapse-timelapses"
import { PUBLIC_REEL_PLATFORMS } from "@/lib/public-reels"
import { MAX_SESSION_CONTENT } from "@/lib/schemas/session"
import type { Project, Week } from "@/lib/types"
import { isRecord } from "@/lib/unknown"
import { uploadFile } from "@/lib/use-handoff"

/* ================================================================== *
 * Journal + timelapse
 * ================================================================== */
/** Hours, written the way a person says them. */
/**
 * How a sheet names its week. The warm-up is week 0 in the store, which is only an address; to the person it is their warm-up.
 */
export function weekName(week: { id: number }): string {
	return week.id === WARMUP_WEEK_ID ? "Warm-up" : `Week ${week.id}`
}

/**
 * Whether a project is the one a week's sheet is about: a warm-up's own week names its project, and a season week's project is its design week's.
 */
export function isWeeksProject(week: Week, project: Project): boolean {
	if (week.projectId) return project.id === week.projectId
	return project.weekId === (week.phase === "build" ? week.id - 5 : week.id)
}

/** The parts list read. A refusal carries none of these fields, so it is read before the shape it is not. */
export const BomResponseSchema = z.object({
	items: z.array(BomLineSchema),
	taxShippingUsd: z.number(),
})

export const JournalDraftSchema = z.object({
	body: z.string(),
	hoursText: z.string(),
	/** Older non-Lapse clips, preserved untouched. */
	legacy: z.array(z.string()).optional(),
	picked: z.array(LapseTimelapseSchema),
	/** Lapse clips kept from the original entry that Lapse would not re-verify. */
	pinned: z.array(z.string()).optional(),
	tab: z.enum(["journal", "timelapse"]),
})

export type JournalDraft = z.infer<typeof JournalDraftSchema>

export const LapseResolveBodySchema = z.object({
	legacy: z.array(z.string()).optional(),
	pinned: z.array(z.string()).optional(),
	resolved: z.array(LapseTimelapseSchema).optional(),
})

export const PublicLinksErrorSchema = z.object({
	error: z
		.object({
			details: z.object({ fields: z.partialRecord(z.enum(PUBLIC_REEL_PLATFORMS), z.string()).optional() }).optional(),
			message: z.string().optional(),
		})
		.optional(),
})

export const draftKey = (checkpointId: string) => `halflife.journal-draft.${checkpointId}`

/** Held for the sign-in round trip to Lapse, which leaves the page. */
export function stashJournalDraft(checkpointId: string, draft: JournalDraft) {
	try {
		window.sessionStorage.setItem(draftKey(checkpointId), JSON.stringify(draft))
	} catch {
		// Private mode or storage off: the trip still works, the draft just does not survive it.
	}
}

export function isJournalDraft(value: unknown): value is JournalDraft {
	return JournalDraftSchema.safeParse(value).success
}

export function peekJournalTrip(checkpointId: string): JournalDraft | null {
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

export const autosaveKey = (checkpointId: string) => `halflife.journal-autosave.${checkpointId}`

/** Placeholders for images still uploading: never persisted, their upload dies with the page. */
export const UPLOADING_PLACEHOLDER = /!\[Uploading .*?\]\(uploading:\d+\)/g

export function cleanBodyForAutosave(body: string): string {
	return body.replaceAll(UPLOADING_PLACEHOLDER, "").replaceAll(/\n{3,}/g, "\n\n")
}

/**
 * An entry no longer than the server will take, cut from the end.
 *
 * Every write to the box ends here. `maxLength` only covers what a person types or pastes – an image arrives as a `setBody` the browser had no say in, and costs more characters once its link is back than the placeholder that stood in for it – so the box can still be handed something the server would refuse.
 */
export function clampToContentLimit(body: string): string {
	return body.length > MAX_SESSION_CONTENT ? body.slice(0, MAX_SESSION_CONTENT) : body
}

/** A draft that survives closing the sheet, reloading, or navigating away. Cleared on save. */
export function readJournalAutosave(checkpointId: string): JournalDraft | null {
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

export function writeJournalAutosave(checkpointId: string, draft: JournalDraft | null) {
	try {
		if (draft) window.localStorage.setItem(autosaveKey(checkpointId), JSON.stringify(draft))
		else window.localStorage.removeItem(autosaveKey(checkpointId))
	} catch {
		// Storage off: the sheet still works, it just cannot keep the draft.
	}
}

export function clearJournalAutosave(checkpointId: string) {
	try {
		window.localStorage.removeItem(autosaveKey(checkpointId))
		window.sessionStorage.removeItem(draftKey(checkpointId))
	} catch {
		// Storage off or already cleared.
	}
}

/** An image for the entry: a file, or the address of one on another page. */
export type ImageSource = File | { url: string; alt: string }

export const IMAGE_ADDRESS = /^(https?:\/\/|data:image\/)/i

/**
 * The images in a drop. Files when there are any; otherwise a picture dragged off another page, which arrives as the page's markup for it (read in an inert document, so nothing loads) and failing that as a bare address that looks like an image. A plain link comes back empty.
 */
export function droppedImages(transfer: DataTransfer): ImageSource[] {
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
export function altFor(source: ImageSource): string {
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
export async function storeImage(source: ImageSource): Promise<{ url: string | null }> {
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
export function withoutPlaceholder(body: string, placeholder: string): string {
	for (const form of [`\n\n${placeholder}`, `${placeholder}\n\n`, placeholder])
		if (body.includes(form)) return body.replace(form, "")
	return body
}

/* ================================================================== *
 * Reel
 * ================================================================== */
export const ReelDraftSchema = z.object({
	caption: z.string(),
	clip: z.string(),
	/** The bucket's URL for the clip, never a blob URL: those die with the page. */
	url: z.string().nullable(),
})

export type ReelDraft = z.infer<typeof ReelDraftSchema>

export const reelDraftKey = (checkpointId: string) => `halflife.reel-draft.${checkpointId}`

/**
 * A reel's draft is the clip already sitting in the bucket plus its caption. The upload is the expensive half and it has already happened by the time Save draft is on offer, so keeping the draft is keeping a key and a line of text – in this browser, like the rest of the ceremony, and cleared on post.
 */
export function readReelDraft(checkpointId: string): ReelDraft | null {
	if (typeof window === "undefined") return null
	try {
		const raw = window.localStorage.getItem(reelDraftKey(checkpointId))
		const parsed = raw ? ReelDraftSchema.safeParse(JSON.parse(raw)) : null
		return parsed?.success ? parsed.data : null
	} catch {
		return null
	}
}

export function writeReelDraft(checkpointId: string, draft: ReelDraft | null) {
	try {
		if (draft) window.localStorage.setItem(reelDraftKey(checkpointId), JSON.stringify(draft))
		else window.localStorage.removeItem(reelDraftKey(checkpointId))
	} catch {
		// Storage off: Save draft still closes the sheet, it just cannot keep it.
	}
}

/**
 * One box a maker has to tick before a resubmission. Styled like the sheet's other confirmations, so a tick reads the same wherever it appears.
 */
export function Acknowledgement({
	checked,
	children,
	onChange,
}: {
	checked: boolean
	children: ReactNode
	onChange(checked: boolean): void
}) {
	return (
		<label
			className={cx(
				"flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
				checked ? "bg-violet-pale" : "hover:bg-black/[.03]",
			)}
		>
			<input checked={checked} className="sr-only" onChange={event => onChange(event.target.checked)} type="checkbox" />
			<span
				aria-hidden="true"
				className={cx(
					"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
					checked ? "border-transparent bg-violet" : "border-line-strong",
				)}
			>
				{checked && <IconCheck className="text-sm text-white" />}
			</span>
			<span className="min-w-0 text-[0.88rem] leading-snug text-navy">{children}</span>
		</label>
	)
}
