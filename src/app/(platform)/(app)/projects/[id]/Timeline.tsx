"use client"

import { IconCheck, IconFilm, IconPencil, IconPlay, IconWarning } from "@/components/platform/icons"
import { useLayoutEffect, useRef, useState } from "react"
import { Markdown } from "@/components/platform/Markdown"
import { Chip, cx } from "@/components/platform/ui"
import { fmtDate, fmtHours } from "@/lib/projects"
import type { TimelineItem, TimelineLapse } from "@/lib/queries/project-page"

/**
 * The whole record of a project, newest first: every journal entry with the
 * timelapses behind it, every reel, and each time a week was handed in and
 * decided.
 *
 * One rule down the left and one marker per moment, so it reads as a single
 * chronology rather than a feed of cards. The marker says what kind of
 * moment it was; the body is only as big as what was put on the record, so a
 * submission is a line and a journal entry is the entry.
 */
export function Timeline({
  items,
  weekFor,
}: {
  items: TimelineItem[]
  /** The trail week a phase of this project ran in, for the "Week 3" labels. */
  weekFor: (phase: "DESIGN" | "BUILD") => number
}) {
  // Which week each moment belongs to is said once, where that week starts,
  // rather than on every entry — and only once there are two weeks to tell
  // apart. A reel carries no phase, so it sits in whichever week is running
  // when it comes up.
  const phaseOf = (item: TimelineItem) => (item.kind === "reel" ? null : item.phase)
  const split = new Set(items.map(phaseOf).filter(Boolean)).size > 1
  let running: "DESIGN" | "BUILD" | null = null
  const rows: React.ReactNode[] = []
  items.forEach((item, i) => {
    const phase = phaseOf(item) ?? running ?? items.slice(i).map(phaseOf).find(Boolean) ?? null
    if (split && phase && phase !== running) {
      running = phase
      rows.push(
        <li key={`week-${phase}`} className="relative grid grid-cols-[32px_minmax(0,1fr)] gap-x-4">
          <span
            aria-hidden="true"
            className="relative z-10 mx-auto mt-1.5 size-2.5 rounded-full bg-violet ring-4 ring-paper"
          />
          <p className="flex items-center gap-3">
            <span className="label shrink-0 text-violet-deep">
              {PHASE[phase]} · week {weekFor(phase)}
            </span>
            <span aria-hidden="true" className="h-0 flex-1 border-t border-dashed border-line" />
          </p>
        </li>,
      )
    }
    rows.push(
      // The id is the anchor Explore's "See more" links to, so the entry
      // someone was reading is the one they land on.
      <li key={item.id} id={item.id} className="relative grid scroll-mt-24 grid-cols-[32px_minmax(0,1fr)] gap-x-4">
        <Marker item={item} />
        <div className="min-w-0 pt-1">
          <Body item={item} />
        </div>
      </li>,
    )
  })

  return (
    <ol className="relative grid gap-6 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-0.5 before:rounded-full before:bg-line">
      {rows}
    </ol>
  )
}

function Marker({ item }: { item: TimelineItem }) {
  const look =
    item.kind === "session"
      ? { tone: "bg-violet-pale text-violet-deep", icon: <IconPencil className="text-[0.85rem]" /> }
      : item.kind === "reel"
        ? { tone: "bg-sky-pale text-sky-deep", icon: <IconFilm className="text-[0.9rem]" /> }
        : item.kind === "submitted"
          ? { tone: "bg-gold-pale text-gold-deep", icon: <IconCheck className="text-[0.8rem]" strokeWidth={3} /> }
          : item.result === "APPROVED"
            ? { tone: "bg-mint text-teal-deep", icon: <IconCheck className="text-[0.8rem]" strokeWidth={3} /> }
            : { tone: "bg-coral/15 text-coral-deep", icon: <IconWarning className="text-[0.85rem]" /> }
  return (
    <span
      aria-hidden="true"
      className={cx("relative z-10 grid size-8 place-items-center rounded-full ring-4 ring-paper", look.tone)}
    >
      {look.icon}
    </span>
  )
}

function When({ at }: { at: number }) {
  return <span className="hand ml-auto shrink-0 text-[0.84rem] text-navy-soft tabular-nums">{fmtDate(at)}</span>
}

const PHASE = { DESIGN: "design", BUILD: "build" } as const

function Body({ item }: { item: TimelineItem }) {
  if (item.kind === "session") {
    return (
      <article>
        <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="text-[0.95rem] font-extrabold text-navy">Journal entry</h3>
          <span className="hand text-[0.84rem] text-teal-deep tabular-nums">
            {fmtHours(item.hours)} logged
            {item.approvedHours !== null && (
              <span className="text-navy-soft"> · {fmtHours(item.approvedHours)} approved</span>
            )}
          </span>
          <When at={item.at} />
        </header>
        <EntryBody source={item.body} />
        {item.lapses.length > 0 && <Lapses lapses={item.lapses} />}
      </article>
    )
  }

  if (item.kind === "reel") {
    return (
      <article>
        <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h3 className="text-[0.95rem] font-extrabold text-navy">Posted a reel</h3>
          {item.status === "PROCESSING" && <Chip tone="gold">Processing</Chip>}
          {item.status === "HIDDEN" && <Chip tone="coral">Hidden from the feed</Chip>}
          <When at={item.at} />
        </header>
        {item.caption && (
          <p className="mt-1.5 max-w-[68ch] text-[0.9rem] leading-relaxed [overflow-wrap:anywhere] text-navy">
            {item.caption}
          </p>
        )}
        {item.videoUrl && (
          // Nothing autoplays and nothing preloads past the poster: a timeline
          // of reels loading at once is a page that eats a phone's data.
          <video
            src={item.thumbnailUrl ? item.videoUrl : `${item.videoUrl}#t=0.1`}
            poster={item.thumbnailUrl ?? undefined}
            preload={item.thumbnailUrl ? "none" : "metadata"}
            controls
            playsInline
            className="mt-3 aspect-[9/16] w-full max-w-[180px] rounded-2xl bg-navy object-cover"
          />
        )}
      </article>
    )
  }

  if (item.kind === "submitted") {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[0.95rem] font-extrabold text-navy">
          Handed in the {PHASE[item.phase]} week for review
        </span>
        <When at={item.at} />
      </p>
    )
  }

  const verdict = {
    APPROVED: { text: "approved", tone: "text-teal-deep" },
    RETURNED: { text: "sent back for changes", tone: "text-coral-deep" },
    REJECTED: { text: "rejected", tone: "text-coral-deep" },
  }[item.result]
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className={cx("text-[0.95rem] font-extrabold", verdict.tone)}>
          The {PHASE[item.phase]} week was {verdict.text}
        </span>
        <When at={item.at} />
      </p>
      {item.comments && (
        <blockquote className="mt-2 max-w-[68ch] rounded-xl bg-black/[.04] px-4 py-3 text-[0.88rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-navy">
          {item.comments}
        </blockquote>
      )}
    </div>
  )
}

/**
 * A journal entry, folded when it runs long. The timeline is for reading the
 * story of a project, and one entry pasted in at a thousand lines should not
 * push every other moment off the page — so past about a dozen lines it
 * fades out behind a toggle, and the whole of it is one click away.
 */
function EntryBody({ source }: { source: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [long, setLong] = useState(false)
  const [open, setOpen] = useState(false)

  useLayoutEffect(() => {
    const el = box.current
    if (el) setLong(el.scrollHeight > el.clientHeight + 4)
  }, [source])

  return (
    <>
      <div
        ref={box}
        className={cx(
          "relative mt-2 max-w-[68ch]",
          !open && "max-h-[18rem] overflow-hidden",
          !open && long && "[mask-image:linear-gradient(to_bottom,#000_70%,transparent)]",
        )}
      >
        <Markdown
          source={source}
          className="grid gap-2.5 text-[0.9rem] leading-relaxed [overflow-wrap:anywhere] text-navy"
        />
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="hand mt-1.5 text-[0.84rem] text-violet-deep underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
        >
          {open ? "fold it back up" : "show the whole entry"}
        </button>
      )}
    </>
  )
}

function footage(seconds: number | null) {
  if (!seconds) return null
  const m = Math.round(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

/**
 * The timelapses behind an entry. They open on Lapse, where they play, rather
 * than inline: Lapse's page is the canonical one and knows how to stream them.
 */
function Lapses({ lapses }: { lapses: TimelineLapse[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-2.5" aria-label="Timelapses">
      {lapses.map((l, i) => {
        const inner = (
          <>
            <span className="relative block aspect-video w-40 overflow-hidden rounded-xl bg-navy/90">
              {l.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Lapse's own CDN, not ours to optimise
                <img src={l.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : null}
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-8 place-items-center rounded-full bg-white/90 text-navy shadow-[0_2px_8px_rgb(0_0_0/0.25)]">
                  <IconPlay className="text-[0.8rem]" />
                </span>
              </span>
            </span>
            <span className="hand mt-1 block text-[0.84rem] text-navy-soft tabular-nums">
              Timelapse {lapses.length > 1 ? i + 1 : ""}
              {footage(l.coveredSeconds) && ` · ${footage(l.coveredSeconds)} of work`}
            </span>
          </>
        )
        return (
          <li key={l.id}>
            {l.href ? (
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-xl transition-transform hover:-translate-y-0.5"
              >
                {inner}
              </a>
            ) : (
              inner
            )}
          </li>
        )
      })}
    </ul>
  )
}
