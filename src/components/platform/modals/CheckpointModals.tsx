"use client"

import Link from "next/link"
import { useEffect, useId, useMemo, useRef, useState } from "react"
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
  IconUpload,
  IconWarning,
} from "@/components/platform/icons"
import { countImages, Markdown, proseLength } from "@/components/platform/Markdown"
import { RepoInput, repoIsValid } from "@/components/platform/RepoField"
import { ReelCapture } from "@/components/platform/reels/ReelCapture"
import { StarterProjectCard } from "@/components/platform/StarterProjectCard"
import { Button, borderedInputClass, Chip, cx, Field, inputClass, OptionRow, Panel } from "@/components/platform/ui"
import { attrUrl } from "@/lib/attr-url"
import { linkLapse } from "@/lib/auth-client"
import type { BomLine } from "@/lib/bom"
import { STARTER_PROJECT_TIER, starterProjectsFor } from "@/lib/config/onboarding"
import { paceTarget, printerById, submitFloorFor, tierBankedFloor, weekAsk } from "@/lib/config/printers"
import { THEMES, WARMUP_WEEK_ID } from "@/lib/config/program"
import { photosRequired, TIERS } from "@/lib/curriculum"
import {
  PLATFORM_INFO,
  PUBLIC_REEL_HASHTAG,
  PUBLIC_REEL_PLATFORMS,
  type PublicReelPlatform,
  readPublicReelLink,
} from "@/lib/public-reels"
import { normalizeRepo } from "@/lib/repo"
import type { RepoCheckResult } from "@/lib/repo-checks"
import { EXAMPLE_JOURNAL_URL } from "@/lib/routes"
import { useStore } from "@/lib/store"
import type { Checkpoint, Project, Week } from "@/lib/types"
import { uploadFile } from "@/lib/use-handoff"
import { ImageUploads, type UploadedImage } from "./ImageUploads"
import { fmtDuration, LapsePicker, type LapseTimelapse } from "./LapsePicker"

import { Modal, ModalTitle } from "./Modal"
import { RepoChecks } from "./RepoChecks"

/* ================================================================== *
 * Journal + timelapse
 * ================================================================== */
/**
 * Two decimals at most, never a trailing zero: 7.5h, 9h, 9.55h. Rounded rather
 * than truncated because binary floats land on 44.799999999999955, and cutting
 * that gives 44.79 for a remainder that is really 44.8.
 */
const to2 = (n: number) => Math.round(n * 100) / 100

/** Hours, written the way a person says them. */
/**
 * How a sheet names its week. The warm-up is week 0 in the store, which is
 * only an address; to the person it is their warm-up.
 */
function weekName(week: { id: number }): string {
  return week.id === WARMUP_WEEK_ID ? "Warm-up" : `Week ${week.id}`
}

/**
 * Whether a project is the one a week's sheet is about: a warm-up's own week
 * names its project, and a season week's project is its design week's.
 */
function isWeeksProject(week: Week, project: Project): boolean {
  if (week.projectId) return project.id === week.projectId
  return project.weekId === (week.phase === "build" ? week.id - 5 : week.id)
}

function fmtH(h: number) {
  return `${to2(h)}h`
}

interface JournalDraft {
  tab: "journal" | "timelapse"
  body: string
  hoursText: string
  picked: LapseTimelapse[]
}

const draftKey = (checkpointId: string) => `halflife.journal-draft.${checkpointId}`

/** Held for the sign-in round trip to Lapse, which leaves the page. */
function stashJournalDraft(checkpointId: string, draft: JournalDraft) {
  try {
    window.sessionStorage.setItem(draftKey(checkpointId), JSON.stringify(draft))
  } catch {
    // Private mode or storage off: the trip still works, the draft just
    // does not survive it.
  }
}

function takeJournalDraft(checkpointId: string): JournalDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(draftKey(checkpointId))
    if (!raw) return null
    window.sessionStorage.removeItem(draftKey(checkpointId))
    return JSON.parse(raw) as JournalDraft
  } catch {
    return null
  }
}

/** An image for the entry: a file, or the address of one on another page. */
type ImageSource = File | { url: string; alt: string }

const IMAGE_ADDRESS = /^(https?:\/\/|data:image\/)/i

/**
 * The images in a drop. Files when there are any; otherwise a picture dragged
 * off another page, which arrives as the page's markup for it (read in an
 * inert document, so nothing loads) and failing that as a bare address that
 * looks like an image. A plain link comes back empty.
 */
function droppedImages(transfer: DataTransfer): ImageSource[] {
  const files = Array.from(transfer.files).filter((f) => f.type.startsWith("image/"))
  if (files.length > 0) return files
  const html = transfer.getData("text/html")
  if (html) {
    const found = Array.from(new DOMParser().parseFromString(html, "text/html").images)
      .map((img) => ({ url: img.getAttribute("src")?.trim() ?? "", alt: img.alt }))
      .filter((img) => IMAGE_ADDRESS.test(img.url))
    if (found.length > 0) return found
  }
  return transfer
    .getData("text/uri-list")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(?:[?#]\S*)?$/i.test(line))
    .map((url) => ({ url, alt: "" }))
}

/** Alt text for an image: what the page called it, else its file name. */
function altFor(source: ImageSource): string {
  let name = source instanceof File ? source.name : source.alt
  if (!name && !(source instanceof File) && !source.url.startsWith("data:")) {
    try {
      name = decodeURIComponent(new URL(source.url).pathname.split("/").pop() ?? "")
    } catch {
      name = ""
    }
  }
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[[\]()]/g, "")
      .trim()
      .slice(0, 80) || "Journal image"
  )
}

/**
 * Put an image in the bucket and hand back its CDN link. A file uploads as
 * itself. An inline `data:` picture is already here, so it uploads as a file
 * too. An address on another site is fetched and re-hosted by the server
 * (/api/upload/from-url): the browser cannot read another site's image, and a
 * hotlinked one can change or vanish after the entry is reviewed.
 */
async function storeImage(source: ImageSource): Promise<{ url: string | null }> {
  if (source instanceof File) return uploadFile(source, "sessions")
  if (source.url.startsWith("data:")) {
    const blob = await (await fetch(source.url)).blob()
    const ext = blob.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"
    return uploadFile(new File([blob], `image.${ext}`, { type: blob.type }), "sessions")
  }
  const res = await fetch("/api/upload/from-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: source.url }),
  })
  const payload = (await res.json().catch(() => null)) as {
    url?: string | null
    error?: { message?: string }
  } | null
  if (!res.ok) throw new Error(payload?.error?.message ?? `That image did not upload (${res.status})`)
  return { url: payload?.url ?? null }
}

/** Take an image's placeholder back out of the entry, with the blank line it came with. */
function withoutPlaceholder(body: string, placeholder: string): string {
  for (const form of [`\n\n${placeholder}`, `${placeholder}\n\n`, placeholder]) {
    if (body.includes(form)) return body.replace(form, "")
  }
  return body
}

export function JournalModal({ checkpoint }: { checkpoint: Checkpoint }) {
  const { setOpenCheckpoint, logSession, editSession, complete, projects, stateOf, weekOfCheckpoint, hoursOf } =
    useStore()

  const week = weekOfCheckpoint(checkpoint)

  // Every journal node is one entry: write it and it is done. The week's clock
  // is what decides whether wrapping up is on the table yet. Opened again once
  // it is done, the same sheet is that entry, to correct — not a new one.
  const [existing] = useState(() => {
    const saved = stateOf(checkpoint.id)
    return saved.done ? saved.log[0] : undefined
  })
  const editing = existing !== undefined
  // Timelapses cannot be re-homed after the fact, so an edit keeps whatever
  // the entry was saved with — and it still counts as the entry's evidence.
  const kept = existing?.clips.length ?? 0

  // A draft survives exactly one trip: out to Lapse to sign in, and back. It
  // is read once and cleared, so it cannot resurrect an entry days later.
  const [draft] = useState(() => takeJournalDraft(checkpoint.id))
  const [tab, setTab] = useState<"journal" | "timelapse">(editing ? "journal" : (draft?.tab ?? "journal"))
  // The Lapse timelapses backing this session.
  const [picked, setPicked] = useState<LapseTimelapse[]>(draft?.picked ?? [])
  const [body, setBody] = useState(draft?.body ?? existing?.body ?? "")
  const [preview, setPreview] = useState(false)
  // Free text, not a number: a controlled number input that coerces as you
  // type eats the decimal point the moment you reach for "1.5".
  const [hoursText, setHoursText] = useState(draft?.hoursText ?? (existing ? String(to2(existing.minutes / 60)) : ""))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const entry = useRef<HTMLTextAreaElement>(null)
  // Images still on their way up. Each one holds a placeholder in the entry
  // until its link comes back, and Finish waits for all of them.
  const [uploading, setUploading] = useState(0)
  const [imageError, setImageError] = useState<string | null>(null)
  // Files being dragged over the sheet. Counted, because every child the drag
  // crosses fires its own enter and leave.
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const placeholderSeq = useRef(0)

  // The fallback is for a season sheet opened before its project row landed;
  // it must never pick the warm-up project, which has no season week.
  const project =
    projects.find((p) => isWeeksProject(week, p)) ??
    projects.find((p) => p.weekId !== WARMUP_WEEK_ID) ??
    projects[0]

  // The claim is what the maker types. The photographs are what makes it a
  // claim rather than a number, which is why the bar rises with it — and they
  // are counted out of the entry itself, so every picture sits in the sentence
  // that explains it instead of in a tray underneath.
  const typed = Math.max(0, Number(hoursText) || 0)
  // Lapse knows how long a recorded session was, so with a timelapse picked
  // and nothing typed, that is the claim — the maker is not asked to retype a
  // number Lapse already has. Typed hours still win when given.
  const coveredSeconds = picked.reduce((sum, t) => sum + t.durationSeconds, 0)
  const fromLapse = typed <= 0 && picked.length > 0 && coveredSeconds > 0
  const claimed = fromLapse ? Math.round((coveredSeconds / 3600) * 100) / 100 : typed
  // At least a minute once there is a claim, so a short recording is not
  // rounded down to nothing.
  const sessionMinutes = claimed > 0 ? Math.max(1, Math.round(claimed * 60)) : 0
  const needPhotos = photosRequired(claimed)
  const shots = countImages(body)
  // Words only: the images are counted above, not twice.
  const written = proseLength(body)

  const longEnough = written >= 200
  const enoughPhotos = shots >= needPhotos
  // A session is backed by a journal entry OR a Lapse timelapse, not both:
  // either one is evidence a reviewer can check the hours against. A written
  // entry needs its hours typed; a timelapse brings its own.
  const journalled = longEnough && enoughPhotos
  const recorded = picked.length > 0 || kept > 0
  const ok = claimed > 0 && (journalled || recorded)

  // One thing at a time — a list of four faults reads as a wall, and only the
  // first one is actionable anyway. Once the hours are in, the entry's next
  // shortfall is named with the other way out beside it, so nobody is told to
  // write 200 characters they could skip with a timelapse. An edit cannot add
  // one, so it is not offered there.
  const orLapse = editing ? "" : " Or cover the session with a Lapse timelapse on the Timelapse tab instead."
  const missing = !ok
    ? claimed <= 0
      ? "Add the hours you spent on this session, or pick a Lapse timelapse."
      : !longEnough
        ? `${200 - written} more characters in your entry, not counting images.${orLapse}`
        : `${needPhotos - shots} more ${needPhotos - shots === 1 ? "image" : "images"} in your entry for ${fmtH(claimed)}.${orLapse}`
    : null

  const hours = hoursOf(week)
  const toFloor = Math.max(0, week.submitHours - hours)

  /**
   * Finishing hands the maker back to the trail rather than straight into
   * another entry. What comes next is the trail's to say: logging these hours
   * may have brought a reel due, or opened the fork at the end of the week,
   * and a modal that reopens itself would march past both.
   */
  async function save() {
    setSaving(true)
    setSaveError(null)
    if (editing) {
      const refused = await editSession(checkpoint.id, sessionMinutes, body.trim())
      setSaving(false)
      if (refused) setSaveError(refused)
      else setOpenCheckpoint(null)
      return
    }
    const refused = await logSession(checkpoint.id, sessionMinutes, body.trim(), {
      clips: picked.map((t) => t.id),
    })
    setSaving(false)
    if (refused) {
      setSaveError(refused)
      return
    }
    complete(checkpoint.id)
    setOpenCheckpoint(null)
  }

  async function signInWithLapse() {
    stashJournalDraft(checkpoint.id, { tab: "timelapse", body, hoursText, picked })
    await linkLapse(`${window.location.pathname}?journal=${encodeURIComponent(checkpoint.id)}`)
  }

  /**
   * Put images into the entry where the cursor is — picked, dropped or
   * pasted, the same way (after Stasis's session form). Each goes in first as
   * a placeholder, `![Uploading name…](uploading:n)`, which no renderer or
   * image count accepts, and is swapped for its CDN link once the upload
   * lands; a failed one is taken back out. One at a time, because uploads are
   * rate-limited per account.
   */
  async function addJournalImages(sources: Iterable<ImageSource>) {
    const all = Array.from(sources)
    const images = all.filter((s) => !(s instanceof File) || s.type.startsWith("image/"))
    setImageError(images.length < all.length ? "Only images can go in an entry, so the rest were left out." : null)
    if (images.length === 0) return

    const items = images.map((source) => {
      const alt = altFor(source)
      placeholderSeq.current += 1
      return { source, alt, placeholder: `![Uploading ${alt}…](uploading:${placeholderSeq.current})` }
    })

    // Each image a paragraph of its own, wherever in the text it lands.
    const at = entry.current?.selectionEnd ?? body.length
    const before = body.slice(0, at)
    const after = body.slice(at)
    const lead = !before.trim() || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n"
    const trail = !after || after.startsWith("\n") ? "" : "\n\n"
    const block = `${lead}${items.map((i) => i.placeholder).join("\n\n")}${trail}`
    setBody(before + block + after)
    requestAnimationFrame(() => {
      const caret = before.length + block.length - trail.length
      entry.current?.setSelectionRange(caret, caret)
    })

    setUploading((n) => n + items.length)
    for (const item of items) {
      try {
        const { url } = await storeImage(item.source)
        if (!url) throw new Error("Image uploads need a public URL before they can be added here")
        swapPlaceholder(item.placeholder, `![${item.alt}](${url})`)
      } catch (err) {
        swapPlaceholder(item.placeholder, null)
        setImageError(err instanceof Error ? err.message : "The image did not upload")
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  /**
   * Replace a placeholder with its link, or take it out (`null`), without
   * moving the caret of someone who kept typing while it uploaded: setting a
   * textarea's value sends the caret to the end, so it is put back, shifted
   * by however much the text before it grew or shrank.
   */
  function swapPlaceholder(placeholder: string, replacement: string | null) {
    const el = entry.current
    const keep =
      el && document.activeElement === el
        ? { start: el.selectionStart, end: el.selectionEnd, at: el.value.indexOf(placeholder), length: el.value.length }
        : null
    setBody((current) =>
      replacement === null ? withoutPlaceholder(current, placeholder) : current.replace(placeholder, replacement),
    )
    if (!keep || keep.at < 0) return
    requestAnimationFrame(() => {
      const box = entry.current
      if (!box) return
      const delta = box.value.length - keep.length
      const move = (p: number) => (p > keep.at ? p + delta : p)
      box.setSelectionRange(move(keep.start), move(keep.end))
    })
  }

  // A drag that could be carrying an image: files, or a picture dragged off
  // another page, which comes as markup and an address rather than a file.
  // Dragging a selection around the entry is plain text, and not ours.
  const mightBeImage = (e: React.DragEvent) =>
    ["Files", "text/html", "text/uri-list"].some((t) => e.dataTransfer.types.includes(t))

  return (
    <Modal
      open
      onClose={() => setOpenCheckpoint(null)}
      accent="var(--color-violet)"
      size="lg"
      scrollKey={tab}
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
              {saveError
                ? saveError
                : uploading > 0
                  ? `Uploading ${uploading === 1 ? "an image" : `${uploading} images`}…`
                  : missing
                  ? missing
                  : editing
                    ? "Saving replaces this entry. It keeps its place on the map."
                    : toFloor > 0
                      ? `${fmtH(toFloor)} more before you can ${week.id === WARMUP_WEEK_ID ? "submit it" : "wrap up the week"}.`
                      : "Submit your project when it's done!"}
            </p>
          </div>

          <Button variant="solid" onClick={() => void save()} disabled={!ok || saving || uploading > 0}>
            {saving ? "Saving…" : editing ? "Save changes" : "Finish"}{" "}
            {editing ? <IconCheck className="text-base" /> : <IconArrowRight className="text-base" />}
          </Button>
        </>
      }
    >
      {/* No tab switch in an edit: the timelapses are fixed to the entry. */}
      <div className={cx("mb-5 flex justify-center", editing && "hidden")}>
        <div
          className="sketch flex gap-1 rounded-full bg-white p-1"
          style={{ "--sk-radius": "999px" } as React.CSSProperties}
        >
          {(["journal", "timelapse"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cx(
                "label rounded-full px-4 py-1.5 transition-colors",
                tab === t ? "bg-navy text-white" : "text-navy-soft hover:text-navy",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === "journal" ? (
        // The whole sheet takes a drop, not just the box: a picture let go an
        // inch off the textarea would otherwise open in the tab and take the
        // unsaved entry with it.
        <div
          onDragEnter={(e) => {
            if (!mightBeImage(e)) return
            e.preventDefault()
            dragDepth.current += 1
            setDragging(true)
          }}
          onDragOver={(e) => {
            if (mightBeImage(e)) e.preventDefault()
          }}
          onDragLeave={(e) => {
            if (!mightBeImage(e)) return
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragging(false)
          }}
          onDrop={(e) => {
            dragDepth.current = 0
            setDragging(false)
            const found = droppedImages(e.dataTransfer)
            const files = Array.from(e.dataTransfer.files)
            // A link or some text is not an image: left to the textarea, which
            // drops it in as text. Files are always caught, images or not, so
            // a PDF let go over the sheet cannot open in the tab and take the
            // unsaved entry with it.
            if (found.length === 0 && files.length === 0) return
            e.preventDefault()
            void addJournalImages(found.length > 0 ? found : files)
          }}
        >
          {editing ? (
            <ModalTitle subWide>Edit this entry</ModalTitle>
          ) : (
            // `subWide`: the modal is the large size and the editor below runs
            // its full width, so a subtitle held to 62ch stopped two-thirds of
            // the way across and wrapped into a ragged column.
            <ModalTitle
              subWide
              sub="Write about the progress you made this work session, complete with pictures/screenshots. Be detailed! Markdown works, images included."
            >
              What did you do this session?
            </ModalTitle>
          )}

          <div className="mb-4 max-w-[220px]">
            <Field label="Hours this session" hint="(9.5 is 9 and a half hours)">
              <input
                value={hoursText}
                onChange={(e) => setHoursText(e.target.value.replace(/[^\d.]/g, ""))}
                inputMode="decimal"
                placeholder="0"
                aria-label="Hours spent on this session"
                className={cx(borderedInputClass, "tabular-nums")}
              />
            </Field>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <span className="label text-navy-soft">Project:</span>
            <span className="label inline-flex items-center gap-1.5 rounded-full bg-orange px-3 py-1.5 text-navy">
              {project?.name ?? `${week.theme} project`}
            </span>
            <span className="hand ml-auto flex flex-wrap gap-x-3 text-[0.78rem] text-navy-soft">
              <a
                href={EXAMPLE_JOURNAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-dashed underline-offset-4 hover:text-navy"
              >
                See an example journal
              </a>
              <Link href="/docs/journalling" className="underline decoration-dashed underline-offset-4 hover:text-navy">
                Unsure? Read our docs
              </Link>
            </span>
          </div>

          {/* Write and read sit side by side rather than behind a swap, so a
              long entry can be checked against its own formatting without
              losing the cursor. Below md there is only room for one, and the
              toggle picks which. */}
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="label text-violet-deep">Your entry</p>
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              aria-pressed={preview}
              className={cx(
                "label inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 transition-colors",
                preview
                  ? "border-violet bg-violet-pale text-violet-deep"
                  : "border-line text-navy-soft hover:border-violet hover:text-navy",
              )}
            >
              <IconEye className="text-base" /> {preview ? "Hide preview" : "Preview"}
            </button>
          </div>

          <div className={cx("grid gap-3", preview && "md:grid-cols-2")}>
            {/* `min-w-0` on both columns: a grid item is otherwise as wide as
                its widest unbroken content, so a long URL in the entry widened
                the column and the preview beside it scrolled sideways. */}
            <div className={cx("relative min-w-0", preview && "hidden md:block")}>
              <Gato
                sizes="160px"
                className="pointer-events-none absolute top-1/2 left-1/2 h-auto w-40 -translate-x-1/2 -translate-y-1/2 opacity-[0.07]"
              />
              <textarea
                ref={entry}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                onPaste={(e) => {
                  // A screenshot on the clipboard goes up like a dropped one;
                  // pasted text is left to the textarea.
                  const pasted = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"))
                  if (pasted.length === 0) return
                  e.preventDefault()
                  void addJournalImages(pasted)
                }}
                rows={9}
                placeholder="Start typing… What did you work on? What worked and what didn't? &#10;&#10; Markdown styling enabled! Drag, drop or paste images straight in."
                aria-label="Journal entry"
                className={cx(
                  borderedInputClass,
                  "relative h-full resize-none",
                  dragging && "border-violet! bg-violet-pale/60",
                )}
              />
              {dragging && (
                <p className="hand pointer-events-none absolute inset-0 grid place-items-center text-[0.95rem] text-violet-deep">
                  drop images to add them to your entry
                </p>
              )}
            </div>

            {preview && (
              <div
                className="sketch thin-scroll max-h-[15rem] min-h-[8rem] min-w-0 overflow-y-auto rounded-xl bg-white px-4 py-3 md:max-h-none"
                style={{ "--sk-color": "var(--color-violet)", "--sk-radius": "12px" } as React.CSSProperties}
              >
                {body.trim() ? (
                  <Markdown source={body} className="grid gap-2.5 text-[0.9rem] leading-relaxed text-navy" />
                ) : (
                  <p className="hand text-[0.85rem] text-navy-soft">
                    nothing to preview yet. headings, **bold**, lists, `code` and ![images](url) all work.
                  </p>
                )}
              </div>
            )}
          </div>

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
              variant="outline"
              size="sm"
              disabled={uploading > 0}
              onClick={() => imageInput.current?.click()}
              aria-label="Add images to your journal entry"
            >
              <IconUpload className="text-base" />
              {uploading > 0 ? "Uploading…" : "Add images"}
            </Button>
            <input
              ref={imageInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                // Copied out first: clearing the input empties the live list.
                const files = Array.from(event.target.files ?? [])
                event.target.value = ""
                void addJournalImages(files)
              }}
            />
            <p className={cx("hand text-[0.76rem] tabular-nums", longEnough ? "text-teal-ink" : "text-navy-soft")}>
              {written} / 200 characters
            </p>
          </div>
          {imageError ? (
            <p role="alert" className="mt-2 text-right text-[0.8rem] font-semibold text-coral-deep">
              {imageError}
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <ModalTitle
            subWide
            sub="Record timelapse(s) on Lapse, publish as unlisted or public, then select it here. It won't show up if the timelapses are listed as private. Make sure you're pausing your timelapse when you're not working on your project!"
          >
            Select your timelapses
          </ModalTitle>

          <LapsePicker
            picked={picked}
            onSignIn={signInWithLapse}
            onToggle={(t) =>
              setPicked((p) => (p.some((x) => x.id === t.id) ? p.filter((x) => x.id !== t.id) : [...p, t]))
            }
          />

          <p className="mt-4 text-center text-[0.82rem] text-navy-soft tabular-nums">
            {picked.length === 0
              ? " "
              : `${picked.length === 1 ? "1 timelapse" : `${picked.length} timelapses`} picked · ${fmtDuration(coveredSeconds)} recorded${
                  fromLapse ? `, logged as ${fmtH(claimed)}` : claimed > 0 ? ` for ${fmtH(claimed)} claimed` : ""
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
interface ReelDraft {
  clip: string
  /** The bucket's URL for the clip, never a blob URL: those die with the page. */
  url: string | null
  caption: string
}

const reelDraftKey = (checkpointId: string) => `halflife.reel-draft.${checkpointId}`

/**
 * A reel's draft is the clip already sitting in the bucket plus its caption.
 * The upload is the expensive half and it has already happened by the time
 * Save draft is on offer, so keeping the draft is keeping a key and a line of
 * text — in this browser, like the rest of the ceremony, and cleared on post.
 */
function readReelDraft(checkpointId: string): ReelDraft | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(reelDraftKey(checkpointId))
    return raw ? (JSON.parse(raw) as ReelDraft) : null
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
 * Asked once, as a yes-or-no, so saying no costs one click. Yes opens the
 * links — one field per platform, all optional but at least one — with the
 * reminder that makes the post count at the top, because it has to be in the
 * caption *before* they post it: their referral link and the programme's
 * hashtag. Each link is saved as its own Public Reels row against this reel.
 */
export function PublicReelModal({
  postId,
  eyebrow,
  videoUrl,
  onClose,
  start = "ask",
}: {
  postId: string
  eyebrow: string
  /** The clip, so it can be saved and uploaded elsewhere. */
  videoUrl: string | null
  onClose: () => void
  /**
   * "links" skips the question — for the Reels page, where pressing "Add
   * where you posted it" has already answered it.
   */
  start?: "ask" | "links"
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

  // Asked for only once they say yes: most people will not, and the lookup
  // reaches the signup list.
  useEffect(() => {
    if (step !== "links" || referral.state !== "loading") return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/me/referral", { cache: "no-store" })
        const body = (await res.json().catch(() => null)) as { link?: string } | null
        if (cancelled) return
        setReferral(res.ok && body?.link ? { state: "ready", link: body.link } : { state: "error" })
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
      window.setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000)
    } catch {
      // Clipboard refused: the text is on screen and selectable.
    }
  }

  const filled = PUBLIC_REEL_PLATFORMS.filter((p) => values[p].trim())

  async function save() {
    // The same check the server runs, so a wrong link is named on its field
    // before anything is sent.
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
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ links: filled.map((platform) => ({ platform, url: values[platform] })) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string; details?: { fields?: Partial<Record<PublicReelPlatform, string>> } }
        } | null
        const fields = body?.error?.details?.fields
        if (fields && Object.keys(fields).length > 0) setErrors(fields)
        else setSaveError(body?.error?.message ?? "Your links didn't save. Try again.")
        return
      }
      setStep("saved")
    } catch {
      setSaveError("Could not reach the server. Your links are still here — try again.")
    } finally {
      setSaving(false)
    }
  }

  if (step === "ask") {
    return (
      <Modal
        open
        onClose={onClose}
        accent="var(--color-violet)"
        size="md"
        labelledBy={titleId}
        eyebrow={eyebrow}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Not now
            </Button>
            <Button variant="solid" onClick={() => setStep("links")}>
              Yes, post it online <IconArrowRight className="text-base" />
            </Button>
          </>
        }
      >
        <ModalTitle id={titleId} sub="You'll earn coins if your post goes viral!">
          Would you like to post your reel online?
        </ModalTitle>
        <p className="hand text-[0.84rem] text-navy-soft">
          Your reel is already on the Doomscroller. This is for Instagram, TikTok, X or YouTube too.
        </p>
      </Modal>
    )
  }

  if (step === "saved") {
    return (
      <Modal
        open
        onClose={onClose}
        accent="var(--color-teal)"
        size="md"
        labelledBy={titleId}
        eyebrow={eyebrow}
        footer={
          <Button variant="solid" onClick={onClose}>
            Done <IconCheck className="text-base" />
          </Button>
        }
      >
        <ModalTitle
          id={titleId}
          sub={`${filled.length === 1 ? "Your link is" : `All ${filled.length} links are`} saved. If a post takes off, we'll be in touch about your coins.`}
        >
          Good luck going viral
        </ModalTitle>
      </Modal>
    )
  }

  const captionLine = referral.state === "ready" ? `${referral.link} ${PUBLIC_REEL_HASHTAG}` : PUBLIC_REEL_HASHTAG

  return (
    <Modal
      open
      onClose={onClose}
      accent="var(--color-violet)"
      size="lg"
      labelledBy={titleId}
      eyebrow={eyebrow}
      footer={
        <>
          <p
            role={saveError ? "alert" : undefined}
            className={cx(
              "hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug",
              saveError ? "text-coral-deep" : "text-navy-soft",
            )}
          >
            {saveError ?? (filled.length === 0 ? "Paste at least one link to save." : " ")}
          </p>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Skip
          </Button>
          <Button variant="solid" onClick={() => void save()} disabled={filled.length === 0 || saving}>
            {saving ? "Saving…" : "Save links"}
          </Button>
        </>
      }
    >
      {/* First, because it has to be in the caption before the post goes up. */}
      <div
        className="sketch mb-5 rounded-2xl bg-sky-pale px-5 py-4"
        style={{ "--sk-color": "var(--color-sky)", "--sk-radius": "16px" } as React.CSSProperties}
      >
        <p className="label text-navy">Before you post</p>
        <p className="mt-1.5 text-[0.9rem] leading-snug text-navy">
          Put your referral link and <span className="font-bold">{PUBLIC_REEL_HASHTAG}</span> in the caption, so we can
          find your post and anyone who joins from it counts for you.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {referral.state === "loading" ? (
            <p className="hand text-[0.84rem] text-navy-soft" aria-live="polite">
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
            <Button variant="outline" size="sm" onClick={() => void copy(referral.link, "link")}>
              {copied === "link" ? "Copied!" : "Copy link"}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void copy(captionLine, "caption")}>
            {copied === "caption" ? "Copied!" : referral.state === "ready" ? "Copy link + hashtag" : "Copy hashtag"}
          </Button>
        </div>
        {videoUrl && (
          <a
            href={attrUrl(videoUrl)}
            download="half-life-reel.mp4"
            className="hand mt-3 inline-block text-[0.84rem] text-sky-ink underline decoration-dashed underline-offset-4 hover:text-navy"
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
        {PUBLIC_REEL_PLATFORMS.map((p) => {
          const info = PLATFORM_INFO[p]
          const fieldId = `${titleId}-${p}`
          const error = errors[p]
          return (
            <div key={p} className="grid gap-1.5">
              <label htmlFor={fieldId} className="label text-violet-deep">
                {info.label}
              </label>
              <input
                id={fieldId}
                value={values[p]}
                onChange={(e) => {
                  const v = e.target.value
                  setValues((prev) => ({ ...prev, [p]: v }))
                  if (errors[p]) setErrors(({ [p]: _, ...rest }) => rest)
                }}
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                placeholder={info.example}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${fieldId}-error` : undefined}
                className={cx(
                  "block w-full rounded-xl border-2 bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-line-strong focus:border-violet focus:bg-white",
                  error ? "border-coral-deep bg-coral/5" : "border-line",
                )}
              />
              {error && (
                <p id={`${fieldId}-error`} className="text-[0.8rem] leading-snug font-semibold text-coral-deep">
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
  const done = stateOf(checkpoint.id).done
  const [draft] = useState(() => readReelDraft(checkpoint.id))
  const [clip, setClip] = useState<string | null>(draft?.clip ?? null)
  // What the preview plays: a blob URL for a file picked on this machine, the
  // bucket's URL for one filmed on the phone or restored from a draft.
  const [previewUrl, setPreviewUrl] = useState<string | null>(draft?.url ?? null)
  // Kept apart from the preview because a blob URL cannot outlive the page,
  // so it is never what a draft remembers.
  const [clipUrl, setClipUrl] = useState<string | null>(draft?.url ?? null)
  const [caption, setCaption] = useState(draft?.caption ?? "")

  // `autoPlay` alone is a request the browser may defer (a tab that was not
  // focused when the clip arrived, say), so the preview asks once more itself.
  const previewVideo = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    void previewVideo.current?.play().catch(() => undefined)
  }, [previewUrl])

  // A blob URL holds the whole video in memory until it is revoked.
  useEffect(() => {
    return () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function capture(key: string | null, url?: string | null) {
    setClip(key)
    setPreviewUrl(url ?? null)
    setClipUrl(url && !url.startsWith("blob:") ? url : null)
  }

  // Posting waits for the server, so there is a post to hang public links on
  // and so a failure says so instead of closing on a reel that never landed.
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState<string | null>(null)
  const [postedId, setPostedId] = useState<string | null>(null)

  async function post() {
    if (!clip) return
    setPosting(true)
    setPostError(null)
    const id = await postReel(checkpoint.id, caption.trim(), clip)
    setPosting(false)
    if (!id) {
      setPostError("Your reel didn't post. Check your connection and try again.")
      return
    }
    writeReelDraft(checkpoint.id, null)
    setPostedId(id)
  }

  // A finished reel asks before it opens the recorder: the checkpoint is done,
  // and another reel is an extra, so reopening one should say that rather
  // than look like the checkpoint asking for its reel again. A draft already
  // under way for it means that question was answered last time.
  const [again, setAgain] = useState(!done || draft !== null)
  const titleId = useId()
  const captionLength = caption.trim().length
  const captionReady = captionLength >= 8
  const captionBlocker = captionReady
    ? null
    : `Caption needs ${8 - captionLength} more character${8 - captionLength === 1 ? "" : "s"} (${captionLength}/8).`
  const postBlocker = !clip ? "Add a clip before posting this reel." : captionBlocker

  // Posted: the same sheet now asks whether it is going anywhere else. The
  // clip's URL comes along so it can be saved and uploaded there.
  if (postedId) {
    return (
      <PublicReelModal
        postId={postedId}
        eyebrow={`${weekName(week)} · ${checkpoint.title}`}
        videoUrl={previewUrl}
        onClose={() => setOpenCheckpoint(null)}
      />
    )
  }

  if (!again) {
    return (
      <Modal
        open
        onClose={() => setOpenCheckpoint(null)}
        accent="var(--color-teal)"
        size="md"
        labelledBy={titleId}
        eyebrow={`${weekName(week)} · ${checkpoint.title}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenCheckpoint(null)}>
              Not now
            </Button>
            <Button variant="solid" onClick={() => setAgain(true)}>
              Post another reel <IconFilm className="text-base" />
            </Button>
          </>
        }
      >
        <ModalTitle
          id={titleId}
          sub="Your first one will stay up, your new one will be added to your project's timeline. If you want to delete the reel, go to the Reels Manager tab!"
        >
          You&apos;ve completed this checkpoint! Would you like to post another reel?
        </ModalTitle>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onClose={() => setOpenCheckpoint(null)}
      accent="var(--color-violet)"
      size="lg"
      eyebrow={`${weekName(week)} · ${checkpoint.title}`}
      footer={
        <>
          {postError ? (
            <p role="alert" className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep">
              {postError}
            </p>
          ) : postBlocker ? (
            <p role="status" className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep">
              {postBlocker}
            </p>
          ) : (
            <p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
              Reels post straight to the Doomscroller.
            </p>
          )}
          <Button
            variant="outline"
            onClick={() => {
              writeReelDraft(checkpoint.id, clip || caption.trim() ? { clip: clip ?? "", url: clipUrl, caption } : null)
              setOpenCheckpoint(null)
            }}
          >
            {/* On a finished checkpoint with nothing started there is no
                draft to keep — it is just the answer to "another one?" */}
            {done && !clip && !caption.trim() ? "Not now" : "Save draft"}
          </Button>
          <Button variant="solid" disabled={Boolean(postBlocker) || posting} onClick={() => void post()}>
            {posting ? "Posting…" : done ? "Post another reel" : "Post reel"} <IconFilm className="text-base" />
          </Button>
        </>
      }
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
            style={{ "--sk-color": "var(--color-sky)", "--sk-radius": "16px" } as React.CSSProperties}
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
            label="Caption"
            hint={captionReady ? "One line. Say what changed." : `At least 8 characters (${captionLength}/8).`}
            id="reel-caption"
          >
            <input
              id="reel-caption"
              value={caption}
              aria-invalid={!captionReady || undefined}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="routed the whole board without a single ratline left"
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mx-auto w-[180px] md:w-full">
          <p className="label mb-2 text-navy-soft">Preview</p>
          <div className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "9 / 16" }}>
            {clip ? (
              <>
                {/* The clip itself, muted and looping, the way the Doomscroller
                    will show it. Without a URL (a draft on a deployment with
                    no public bucket URL) it says so rather than standing a
                    stock illustration in for someone's footage. */}
                {previewUrl ? (
                  <video
                    ref={previewVideo}
                    key={previewUrl}
                    src={attrUrl(previewUrl)}
                    autoPlay
                    muted
                    loop
                    playsInline
                    aria-label="Preview of your reel"
                    className="absolute inset-0 size-full bg-navy object-cover"
                  />
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
                style={{ "--sk-radius": "12px" } as React.CSSProperties}
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
 * Project creation (weeks 2–5, and week 1 once its project is deleted)
 * ================================================================== */
export function ProjectModal({ checkpoint }: { checkpoint: Checkpoint }) {
  const { setOpenCheckpoint, complete, addProject, ensureProject, experience, weekOf } = useStore()
  const week = weekOf(checkpoint.weekId)
  // Opening "create a project" is what makes the week's project row — not
  // signing up, when nobody knows yet whether they will get this far.
  useEffect(() => {
    void ensureProject(checkpoint.weekId)
  }, [checkpoint.weekId, ensureProject])
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [tier, setTier] = useState<1 | 2 | 3>(experience === "lots" ? 3 : experience === "some" ? 2 : 1)
  const [showExamples, setShowExamples] = useState(false)
  const [repo, setRepo] = useState("")
  // The week's starter projects, for someone who said they are new to
  // hardware. Weeks follow the theme order, design then build, so the week
  // number names the theme.
  const theme = THEMES[(week.id - 1) % THEMES.length]?.id
  const starters = theme && (experience === "first" || experience === "little") ? starterProjectsFor(theme) : []
  // Taking one fills the form in and holds the tier at 1, as onboarding does.
  const [starterId, setStarterId] = useState<string | null>(null)
  const takeStarter = (s: (typeof starters)[number]) => {
    setStarterId(s.id)
    setName(s.title)
    setDesc(s.description)
    setTier(STARTER_PROJECT_TIER)
  }

  const ok = name.trim().length > 1 && desc.trim().length > 4 && repoIsValid(repo)

  return (
    <Modal
      open
      onClose={() => setOpenCheckpoint(null)}
      accent={week.accent}
      size="lg"
      eyebrow={`Week ${week.id} · ${week.fullName}`}
      footer={
        <>
          <p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
            Tier can be changed any time before you submit this week.
          </p>
          <Button variant="outline" onClick={() => setOpenCheckpoint(null)}>
            Cancel
          </Button>
          <Button
            variant="solid"
            disabled={!ok}
            onClick={() => {
              addProject({
                name: name.trim(),
                description: desc.trim(),
                weekId: week.id,
                tier,
                starter: starterId !== null,
                starterProjectId: starterId,
                githubRepo: normalizeRepo(repo).url,
                designStatus: "draft",
                buildStatus: "draft",
              })
              complete(checkpoint.id, { artefacts: 1 })
              setOpenCheckpoint(null)
            }}
          >
            Create project <IconArrowRight className="text-base" />
          </Button>
        </>
      }
    >
      <ModalTitle sub={week.summary}>{week.headline}</ModalTitle>

      <div className="grid gap-6 lg:grid-cols-[1fr_230px] lg:items-start">
        <div className="grid gap-4">
          {starters.map((s) => {
            const chosen = starterId === s.id
            return (
              <StarterProjectCard
                key={s.id}
                starter={s}
                chosen={chosen}
                action={
                  chosen ? (
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <Chip tone="teal">
                        <IconCheck className="text-[0.9rem]" /> Building {s.title}
                      </Chip>
                      <button
                        type="button"
                        onClick={() => setStarterId(null)}
                        className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
                      >
                        Use my own idea instead
                      </button>
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => takeStarter(s)}>
                      Build {s.title}
                    </Button>
                  )
                }
              />
            )
          })}
          <Field label="Project name" hint="Give it a cool name." id="np-name">
            <input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${week.theme.toLowerCase()} project`}
              className={inputClass}
            />
          </Field>
          <Field label="Project description" hint="What it does, and what makes it yours." id="np-desc">
            <textarea
              id="np-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder={week.examples[0]}
              className={cx(inputClass, "resize-none")}
            />
          </Field>
          <RepoInput id="np-repo" value={repo} onChange={setRepo} />

          <button
            type="button"
            onClick={() => setShowExamples((v) => !v)}
            className="hand self-start text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
          >
            {showExamples ? "Hide examples" : "Stuck? See what other people are making"}
          </button>
          {showExamples && (
            <ul className="grid gap-2">
              {week.examples.map((e) => (
                <li key={e}>
                  <button
                    type="button"
                    onClick={() => setDesc(e)}
                    className="sketch w-full rounded-xl bg-white px-4 py-2.5 text-left text-[0.9rem] leading-snug text-navy transition-colors hover:bg-violet-pale/60"
                    style={{ "--sk-radius": "12px" } as React.CSSProperties}
                  >
                    {e}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-2">
            <p className="label mb-2 text-violet-deep">Funding tier</p>
            {starterId !== null && (
              <p className="hand mb-2.5 text-[0.82rem] text-navy-soft">
                Starter projects are Tier 1. Switch to your own idea to choose a different tier.
              </p>
            )}
            {/* The hours quoted here are the ones the submit gate will hold
                you to, not the funded block. A tier that advertises its
                funding alone advertises the smaller of two numbers: the funded
                hours bank nothing, so the printer money has to be worked on
                top of them. */}
            <div className="grid gap-2.5">
              {TIERS.map((t) => (
                <OptionRow
                  key={t.id}
                  selected={tier === t.id}
                  disabled={starterId !== null && t.id !== STARTER_PROJECT_TIER}
                  onClick={() => setTier(t.id)}
                  hint={
                    <>
                      {t.detail}
                      <span className="mt-1 block text-navy-soft/90">
                        You can submit on tier {t.id} from {fmtH(submitFloorFor(t.fundingHours))} of design time, and{" "}
                        {fmtH(tierBankedFloor(t.fundingHours))} of that goes toward your printer goal.
                      </span>
                    </>
                  }
                >
                  <span className="flex flex-wrap items-baseline gap-x-2.5">
                    <span className="text-[0.98rem] font-extrabold text-navy">Tier {t.id}</span>
                    <span className="hand text-[0.86rem] text-teal-ink">${t.grantUsd} for parts</span>
                    <span className="hand text-[0.8rem] text-navy-soft">
                      · {fmtH(submitFloorFor(t.fundingHours))} to submit
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
              theme={week.theme}
              sizes="(min-width: 1024px) 198px, 220px"
              className="sticker-shadow mx-auto aspect-square w-full max-w-[220px]"
            />
          </div>
          <p className="mt-3 text-[0.86rem] leading-snug text-navy-soft">{week.primer.split(". ")[0]}.</p>
        </div>
      </div>
    </Modal>
  )
}

/* ================================================================== *
 * Submit gate
 * ================================================================== */
/**
 * A Submit checkpoint whose week is already handed in and waiting for review.
 *
 * Opening it again is almost always "I need to change something", so it says
 * where the week stands and offers the one thing that allows a change: taking
 * it back out of review. Nothing is lost by it — the entries, parts list and
 * details stay as they are, and this same checkpoint hands it in again.
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
      open
      onClose={() => setOpenCheckpoint(null)}
      accent="var(--color-violet)"
      size="md"
      labelledBy={titleId}
      eyebrow={`${weekName(week)} · ${checkpoint.title}`}
      footer={
        <>
          {error && (
            <p role="alert" className="hand mr-auto min-w-0 flex-1 text-[0.84rem] leading-snug text-coral-deep">
              {error}
            </p>
          )}
          <Button variant="outline" onClick={() => setOpenCheckpoint(null)} disabled={busy}>
            Keep it in review
          </Button>
          <Button variant="solid" onClick={() => void unsubmit()} disabled={busy}>
            {busy ? "Unsubmitting…" : week.id === WARMUP_WEEK_ID ? "Unsubmit your warm-up" : `Unsubmit week ${week.id}`}
          </Button>
        </>
      }
    >
      <ModalTitle
        id={titleId}
        sub={`${handedIn ? `Handed in ${new Date(handedIn).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. ` : ""}Unsubmitting takes it out of the review queue so you can change your entries, parts list or project details. Hand it in again from this checkpoint when you're done.`}
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
  } = useStore()
  const week = weekOfCheckpoint(checkpoint)
  const isBuild = week.phase === "build"

  // The week is long enough to hand in — that gate is the trail's, and this
  // node would be locked otherwise. What is left to say is whether it was
  // long enough for the machine actually on the wall. A surplus banked in an
  // earlier week pays for a thin one, so this reads the running total against
  // the pace rather than this week against its target.
  //
  // The running total is the fund plus what unreviewed weeks will bank. Coins
  // are minted at approval, so the fund alone reads this very week — the one
  // being handed in, which nobody can have reviewed yet — as banking nothing,
  // and warned everyone on every submit.
  const goal = printerById(goalId)
  const owed = Math.max(0, Math.ceil(paceTarget(goal, week.id) - printerFund - pendingCoins(week.id)))

  // The fallback is for a season sheet opened before its project row landed;
  // it must never pick the warm-up project, which has no season week.
  const project =
    projects.find((p) => isWeeksProject(week, p)) ??
    projects.find((p) => p.weekId !== WARMUP_WEEK_ID) ??
    projects[0]

  const [step, setStep] = useState(1)
  // R2 object keys, not flags: what these ask for is evidence, and a boolean
  // was letting the form take a file and drop it on the floor.
  // Several screenshots, because one order is often split across vendors and
  // one checkout page is not always one screen tall.
  const [carts, setCarts] = useState<UploadedImage[]>([])
  const [tier, setTier] = useState<1 | 2 | 3>(project?.tier ?? 1)
  const [clip, setClip] = useState<string | null>(null)
  // The bucket URL of the closing clip, when there is one, so it can be saved
  // and posted elsewhere afterwards.
  const [clipUrl, setClipUrl] = useState<string | null>(null)
  // A blob URL for a locally picked clip holds the whole video in memory
  // until it is revoked — the preview is replaced or the sheet closes, not
  // before.
  useEffect(() => {
    return () => {
      if (clipUrl?.startsWith("blob:")) URL.revokeObjectURL(clipUrl)
    }
  }, [clipUrl])
  // The closing reel once it is posted. A hand-in that fails after the reel
  // went up reuses it on the retry rather than posting the same clip twice;
  // a new clip clears it.
  const [closingPostId, setClosingPostId] = useState<string | null>(null)
  // Handed in: the reel that closed the week is offered for posting online.
  const [shareId, setShareId] = useState<string | null>(null)
  const [works, setWorks] = useState<"yes" | "no" | null>(null)
  const [writeup, setWriteup] = useState("")
  // Null while checking. The server runs the same checks at submit, so this
  // only decides whether the sheet lets you get that far.
  const [repoResult, setRepoResult] = useState<RepoCheckResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // The closing reel is a reel like any other and goes on the trail under its
  // own key, so the week's timeline shows it where it happened rather than
  // swallowing it inside the submission.
  const reelCheckpointId = week.projectId ? `wu-${week.projectId}-reel-submission` : `w${week.id}-reel-submission`
  const closingSubject = week.id === WARMUP_WEEK_ID ? `Warm-up: ${project?.name ?? "my project"}` : `Week ${week.id}: ${week.theme}`
  const closingCaption = `${closingSubject} ${isBuild ? "built" : "designed"}.`
  const buildNotes = works === "no" && writeup.trim() ? writeup.trim() : undefined

  const total = isBuild ? 2 : 3
  // The project's own parts list, as kept on its page — read fresh when the
  // sheet opens, because it is edited there and this is the moment it is
  // handed in. Null while it loads; the cart total reads zero until then.
  const [bom, setBom] = useState<{ items: BomLine[]; taxShippingUsd: number } | null>(null)
  const [bomError, setBomError] = useState<string | null>(null)
  useEffect(() => {
    if (isBuild || !project) return
    let live = true
    fetch(`/api/projects/${project.id}/bom`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.error?.message ?? "Could not load the parts list")
        if (live) setBom({ items: body.items, taxShippingUsd: body.taxShippingUsd ?? 0 })
      })
      .catch((err: Error) => live && setBomError(err.message))
    return () => {
      live = false
    }
  }, [isBuild, project?.id]) // eslint-disable-line react-hooks/exhaustive-deps -- the id is the input
  const bomTotal = useMemo(
    () => (bom?.items.reduce((n, l) => n + l.quantity * l.unitCostUsd, 0) ?? 0) + (bom?.taxShippingUsd ?? 0),
    [bom],
  )

  /**
   * A tier is a claim about hours as much as about money: its funded block has
   * to be covered, and the banking that buys the printer has to sit on top of
   * it. Tier 2 funds thirteen hours, so thirteen hours pay for the project and
   * nothing at all banks until the fourteenth — which is why the tier cannot be
   * raised at the last moment on hours that were only ever enough for a
   * smaller one.
   *
   * Two asks come out of that, and they are different numbers. The floor is
   * the cheapest machine's pace, and below it the season cannot end in a
   * printer at all, so it is a gate. The target is this maker's own goal, and
   * it moves when they change what they are saving for — a P1S asks far more
   * of a tier 2 week than an Ender does. Missing the target is a warning the
   * sheet already gives; missing the floor is a refusal.
   */
  const hours = hoursOf(week)
  const tierFloor = submitFloorFor
  const tierTarget = (fundingHours: number) => weekAsk(goal.hoursPerWeek, fundingHours)
  const tierShort = (fundingHours: number) => Math.max(0, tierFloor(fundingHours) - hours)
  const selectedTier = TIERS.find((t) => t.id === tier) ?? TIERS[0]
  const tierBlocked = !isBuild && tierShort(selectedTier.fundingHours) > 0

  const repoReady = repoResult?.canSubmit ?? false

  const canAdvance =
    step === 1
      ? repoReady
      : isBuild
        ? clip && (works === "yes" || (works === "no" && writeup.trim().length >= 40))
        : step === 2
          ? carts.length > 0 && !tierBlocked
          : clip && !tierBlocked

  /**
   * Handing a week in, in the order the pieces depend on each other.
   *
   * The tier first, because it is what the reviewer will be deciding against.
   * Then the closing reel, awaited, so the submission a reviewer opens — and
   * the YSWS row written just after it, which looks the reel up — already has
   * the video rather than one arriving behind it. It is posted once: a retry
   * after a refused hand-in reuses it. The submission last, and only once it
   * has gone through is the reel offered for posting online.
   */
  async function submit() {
    setSubmitting(true)
    setSubmitError(null)
    if (project) setProjectTier(project.id, tier)
    let postId = closingPostId
    if (clip && !postId) {
      postId = await postReel(reelCheckpointId, closingCaption, clip)
      if (postId) setClosingPostId(postId)
    }
    const refused = await submitPhase(checkpoint.id, {
      notes: isBuild ? buildNotes : undefined,
      attachmentKeys: carts.map((c) => c.objectKey),
    })
    setSubmitting(false)
    if (refused) {
      setSubmitError(refused)
      return
    }
    if (postId) setShareId(postId)
    else setOpenCheckpoint(null)
  }

  if (shareId) {
    return (
      <PublicReelModal
        postId={shareId}
        eyebrow={`${weekName(week)} · Submitted`}
        videoUrl={clipUrl}
        onClose={() => setOpenCheckpoint(null)}
      />
    )
  }

  return (
    <Modal
      open
      onClose={() => setOpenCheckpoint(null)}
      accent="var(--color-magenta)"
      size="lg"
      scrollKey={step}
      eyebrow={`Submit ${week.id === WARMUP_WEEK_ID ? "your warm-up" : `week ${week.id}`} · ${step}/${total}`}
      footer={
        <>
          <Button variant="outline" onClick={() => (step === 1 ? setOpenCheckpoint(null) : setStep((s) => s - 1))}>
            {step === 1 ? "Not yet" : "Back"}
          </Button>
          {submitError && (
            <p role="alert" className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep">
              {submitError}
            </p>
          )}
          {step === 1 && !submitError && !repoReady && repoResult && (
            <p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep">
              Fix the repo checks above to carry on.
            </p>
          )}
          {step < total ? (
            <Button variant="solid" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
              Next <IconArrowRight className="text-base" />
            </Button>
          ) : (
            <Button variant="coral" disabled={!canAdvance || submitting} onClick={() => void submit()}>
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
    >
      {/* On every step, not just the last one: a maker who is short on hours
          should find that out before working through the checklist, not after.
          It warns and does not block — the hours needed for a printer at all
          are the trail's gate, and this is the gap to the one they chose. */}
      {owed > 0 && (
        <div
          className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
          style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" } as React.CSSProperties}
        >
          <IconWarning className="mt-0.5 shrink-0 text-xl text-coral-deep" />
          <div className="min-w-0">
            <p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
              You&apos;re a little behind on your printer goal.
            </p>
            <p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
              Spend some more time on it! You are <span className="font-bold text-navy tabular-nums">{owed}</span>{" "}
              {owed === 1 ? "coin" : "coins"} behind the pace for a{" "}
              <span className="font-bold text-navy">{goal.name}</span>. You can still hand it in, and a bigger week
              later makes it up.
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
          {project && <RepoChecks project={project} onResult={setRepoResult} />}
        </div>
      )}

      {!isBuild && step === 2 && (
        <div>
          <ModalTitle sub="Every line needs a real vendor and a real price. We ask for the cart screenshot so the total is checkable.">
            Finalise your BOM and tier
          </ModalTitle>

          <Panel tone="line" radius={18} className="overflow-hidden bg-white">
            {bomError ? (
              <p role="alert" className="px-4 py-5 text-[0.86rem] font-semibold text-coral-deep">
                {bomError}
              </p>
            ) : !bom ? (
              <p className="hand px-4 py-5 text-[0.88rem] text-navy-soft" aria-live="polite">
                reading your parts list…
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-[0.86rem]">
                  <thead>
                    <tr className="border-b border-dashed border-line">
                      {["Part", "Qty", "Unit", "Total", "Vendor"].map((h) => (
                        <th key={h} scope="col" className="label px-4 py-2.5 text-navy-soft">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bom.items.length === 0 && (
                      <tr className="border-b border-dashed border-line/60">
                        <td colSpan={5} className="hand px-4 py-3.5 text-[0.88rem] text-coral-deep">
                          no parts listed yet. Add them on the project page before you hand this in.
                        </td>
                      </tr>
                    )}
                    {bom.items.map((l) => (
                      <tr key={l.id} className="border-b border-dashed border-line/60 align-top">
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
                              href={l.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline decoration-line-strong underline-offset-4 hover:text-navy"
                            >
                              {l.vendor || "link"}
                            </a>
                          ) : (
                            l.vendor || "—"
                          )}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="px-4 py-2.5">
                        <span className="block font-semibold text-navy">Tax &amp; shipping</span>
                        <span className="block text-[0.8rem] leading-snug text-navy-soft">for the whole order</span>
                      </td>
                      <td className="px-4 py-2.5 text-navy-soft">—</td>
                      <td className="px-4 py-2.5 text-navy-soft">—</td>
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
          {/* One place to change the list: the project page. The sheet reads
              it, so what is handed in is what the maker kept there. */}
          {project && (
            <p className="hand mt-2 text-[0.82rem] text-navy-soft">
              Something wrong?{" "}
              <Link
                href={`/projects/${project.id}#bom-title`}
                onClick={() => setOpenCheckpoint(null)}
                className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
              >
                Edit the parts list on the project page
              </Link>
              .
            </p>
          )}

          <div className="mt-8 border-t border-dashed border-line pt-6">
            <div className="grid gap-2">
              <p className="label flex items-center gap-2 text-navy-soft">
                <IconCart className="text-base" /> Screenshots of your cart
              </p>
              <p className="text-[0.88rem] leading-snug text-navy-soft">
                The checkout page with the total visible. Any vendor — add one per cart if the order is split.
              </p>
              <ImageUploads images={carts} onChange={setCarts} folder="sessions" max={10} label="Cart screenshot" />
            </div>
          </div>

          <div className="mt-8 border-t border-dashed border-line pt-6">
            <p className="label mb-2 text-magenta">Finalise your tier</p>
            <p className="mb-3 text-[0.82rem] leading-snug text-navy-soft">
              Find out which tier you&apos;re eligible for! Your current goal is a{" "}
              <span className="font-bold text-navy">{goal.name}</span> and you have{" "}
              <span className="font-bold text-navy tabular-nums">{fmtH(hours)}</span> this week.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-3">
              {TIERS.map((t) => {
                const on = tier === t.id
                const over = bomTotal > t.grantUsd
                const short = tierShort(t.fundingHours)
                const behind = Math.max(0, tierTarget(t.fundingHours) - hours)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTier(t.id)}
                    aria-pressed={on}
                    // A tier you have not worked the hours for is not an
                    // option, so it does not behave like one.
                    disabled={short > 0}
                    className={cx(
                      "sketch rounded-2xl px-4 py-3 text-left transition-colors",
                      short > 0
                        ? "cursor-not-allowed bg-black/[.03]"
                        : on
                          ? "bg-violet-pale"
                          : "bg-white hover:bg-black/[.03]",
                    )}
                    style={
                      {
                        "--sk-color": on ? "var(--color-violet)" : "var(--color-line)",
                        "--sk-radius": "16px",
                      } as React.CSSProperties
                    }
                  >
                    <span
                      className={cx("block text-[0.95rem] font-extrabold", short > 0 ? "text-navy-soft" : "text-navy")}
                    >
                      Tier {t.id}
                    </span>
                    <span className={cx("hand block text-[0.86rem]", short > 0 ? "text-navy-soft" : "text-teal-ink")}>
                      ${t.grantUsd} for parts
                    </span>

                    {/* The hours are the gate, so they lead. The cart only
                        says whether the money fits inside the tier once the
                        tier is actually available to you. */}
                    <span
                      className={cx(
                        "mt-1 block text-[0.76rem] leading-snug",
                        short > 0 ? "text-coral-deep" : behind > 0 ? "text-navy-soft" : "text-teal-ink",
                      )}
                    >
                      {short > 0
                        ? `Opens at ${fmtH(tierFloor(t.fundingHours))} of design time, ${fmtH(short)} to go`
                        : behind > 0
                          ? `${fmtH(tierTarget(t.fundingHours))} for a ${goal.name}, ${fmtH(behind)} to go`
                          : `${fmtH(tierTarget(t.fundingHours))} for a ${goal.name}, you have ${fmtH(hours)}`}
                    </span>
                    {short === 0 && over && (
                      <span className="hand mt-1 block text-[0.74rem] leading-snug text-coral-deep">
                        Cart over by ${(bomTotal - t.grantUsd).toFixed(2)}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
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

          {isBuild && (
            <div className="mt-6">
              <p className="label mb-2 text-magenta">Does it work?</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                <OptionRow selected={works === "yes"} onClick={() => setWorks("yes")}>
                  <span className="text-[0.95rem] font-bold text-navy">Yes — it does the thing</span>
                </OptionRow>
                <OptionRow selected={works === "no"} onClick={() => setWorks("no")}>
                  <span className="text-[0.95rem] font-bold text-navy">Not yet</span>
                </OptionRow>
              </div>

              {works === "no" && (
                <div className="mt-4">
                  <Field
                    label="What needs to change"
                    hint="Reviewers pass honest failures and fail silent ones. Say what you would do next."
                    id="writeup"
                  >
                    <textarea
                      id="writeup"
                      rows={5}
                      value={writeup}
                      onChange={(e) => setWriteup(e.target.value)}
                      placeholder="The display initialises but stays blank. I think the reset pin is floating — next revision ties it through a 10k to 3V3 and I will bodge it in the meantime."
                      className={cx(inputClass, "resize-none")}
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
