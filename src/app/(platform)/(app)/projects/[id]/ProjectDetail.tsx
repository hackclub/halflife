"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { IconChevronLeft, IconClock } from "@/components/platform/icons"
import { RepoChecks } from "@/components/platform/modals/RepoChecks"
import { Button, Chip, cx, Panel } from "@/components/platform/ui"
import { DESIGN_WEEKS } from "@/lib/config/printers"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { TIERS } from "@/lib/curriculum"
import { fmtDate, fmtHours } from "@/lib/projects"
import type { ProjectPageData } from "@/lib/queries/project-page"
import { displayRepo } from "@/lib/repo"
import { REVIEW_STATUS_DOT, REVIEW_STATUS_TEXT, reviewChipTone } from "@/lib/review-state"
import { useStore } from "@/lib/store"
import { BomEditor } from "./BomEditor"
import { HackatimeLinks } from "./HackatimeLinks"
import { ProjectDetails } from "./ProjectDetails"
import { CoverImage } from "./ProjectHeaderParts"
import { Timeline } from "./Timeline"

function BackLink() {
  return (
    <Link
      href="/projects"
      className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
    >
      <IconChevronLeft className="text-base" /> All projects
    </Link>
  )
}

/** A titled section of the page. */
function Section({
  title,
  aside,
  children,
  id,
}: {
  title: string
  aside?: React.ReactNode
  children: React.ReactNode
  id: string
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id={id} className="label text-violet-deep">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

/**
 * One project, laid out the way Stasis lays out its project page: what it is
 * at the top with its thumbnail beside it, then what the repo has, the hours
 * tracked elsewhere, the parts list, and last the full record of the work —
 * every entry, timelapse, reel and review, newest first.
 *
 * The store supplies the project's name, tier and weeks, as it does for every
 * page; the server supplies the rest in `data`, because the timeline's media
 * and the parts list are only ever wanted here.
 */

/** Ask a reviewer to read a decision again. Changes no state. */
function DisputeForm({
  projectId,
  phase,
  onClose,
}: {
  projectId: string
  phase: "DESIGN" | "BUILD"
  onClose: () => void
}) {
  const router = useRouter()
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (note.trim().length < 10) return setError("Tell us what looks wrong — a sentence is enough.")
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/dispute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phase, note: note.trim() }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `That did not send (${res.status})`)
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError("Could not reach the server. Try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-2.5 rounded-xl border-2 border-line bg-cream/60 p-3.5">
      <label htmlFor={`dispute-${phase}`} className="label text-violet-deep">
        What looks wrong?
      </label>
      <textarea
        id={`dispute-${phase}`}
        value={note}
        onChange={(e) => {
          setNote(e.target.value)
          if (error) setError(null)
        }}
        rows={3}
        maxLength={2000}
        placeholder="The build works — the video runs at 1:20."
        className="block w-full rounded-xl border-2 border-field bg-white px-3.5 py-2.5 text-[0.9rem] text-navy outline-none placeholder:text-navy-faint transition-colors hover:border-navy-soft focus:border-violet"
      />
      {error && (
        <p role="alert" className="text-[0.82rem] font-semibold text-coral-deep">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="solid" size="sm" disabled={saving} onClick={() => void submit()}>
          {saving ? "Sending…" : "Ask for a second look"}
        </Button>
        <Button variant="ghost" size="sm" disabled={saving} onClick={onClose}>
          Cancel
        </Button>
      </div>
      <p className="hand text-[0.8rem] text-navy-soft">
        this does not change the decision — it asks a reviewer to read it again.
      </p>
    </div>
  )
}

/**
 * The warm-up's own trail, flattened onto its page: what it has logged against
 * what submitting asks, the next entry to write, and its one submit. The
 * sheets these open are the season's own journal and submit sheets, run on the
 * warm-up's week 0, so writing and handing in work the same way everywhere.
 */
function WarmupWork({ projectId }: { projectId: string }) {
  const { warmupWeekOf, hoursOf, passedOf, statusOf, lastDayOf, stateOf, setOpenCheckpoint } = useStore()
  const warmupWeek = warmupWeekOf(projectId)
  if (!warmupWeek) return null

  const build = warmupWeek.phase === "build"
  const hours = hoursOf(warmupWeek)
  const need = warmupWeek.submitHours
  const status = statusOf(warmupWeek)
  const handedIn = status === "in_review" || status === "approved" || status === "rejected"
  const passed = passedOf(warmupWeek)
  const lastDay = lastDayOf(warmupWeek)
  const submitId = `wu-${projectId}-submit`

  const entries = warmupWeek.checkpoints.filter((c) => c.kind === "journal")
  const written = entries.filter((c) => stateOf(c.id).done)
  const next = entries.find((c) => !stateOf(c.id).done)
  // Once the journal has closed, what there is can still be handed in, as a
  // season week that has passed can.
  const canSubmit = !handedIn && (hours >= need || (passed && hours > 0))
  const short = Math.max(0, need - hours)

  return (
    <Section id="warmup-title" title="Warm-up">
      <Panel tone="line" radius={20} className="bg-paper px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <p className="text-[0.95rem] font-extrabold text-navy tabular-nums">
            {fmtHours(hours)} logged
            <span className="font-semibold text-navy-soft">
              {" "}
              · {build ? "a finished build" : "a design"}, submit from {fmtHours(need)}
            </span>
          </p>
          {lastDay && (
            <p className="hand text-[0.84rem] text-navy-soft">
              {passed ? `journal closed after ${lastDay}` : `journal open until ${lastDay}`}
            </p>
          )}
        </div>

        {handedIn ? (
          <p className="mt-3 text-[0.9rem] leading-relaxed text-navy-soft">
            Submitted. Where it stands with review is below.
          </p>
        ) : (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              {next && !passed && (
                <Button variant="gold" onClick={() => setOpenCheckpoint(next.id)}>
                  Log a session
                </Button>
              )}
              <Button variant="solid" disabled={!canSubmit} onClick={() => setOpenCheckpoint(submitId)}>
                {build ? "Submit your build" : "Submit your design"}
              </Button>
              {!canSubmit && short > 0 && (
                <span className="hand text-[0.84rem] text-navy-soft tabular-nums">
                  {fmtHours(short)} more to submit
                </span>
              )}
            </div>
            {passed && (
              <p className="mt-3 text-[0.86rem] leading-relaxed text-navy-soft">
                Week 1 has opened, so this warm-up takes no new entries. You can still submit what you have.
              </p>
            )}
            {written.length > 0 && !passed && (
              <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[0.84rem] text-navy-soft">
                <span>Edit an entry:</span>
                {written.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setOpenCheckpoint(c.id)}
                    className="font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
                  >
                    {c.title}
                  </button>
                ))}
              </p>
            )}
          </>
        )}
      </Panel>
    </Section>
  )
}

/** Where each phase stands with review, above the repo checks. */
function ReviewState({
  projectId,
  phases,
  weekFor,
  warmup,
}: {
  projectId: string
  phases: ProjectPageData["phases"]
  weekFor: (phase: "DESIGN" | "BUILD") => number
  /** A warm-up project's submit sheet lives on week 0, whichever its phase. */
  warmup: boolean
}) {
  const { setOpenCheckpoint } = useStore()
  const [disputing, setDisputing] = useState<"DESIGN" | "BUILD" | null>(null)

  return (
    <Panel tone="line" radius={20} className="bg-paper px-5 py-5 sm:px-6">
      <ul className="grid gap-5">
        {phases.map((p) => {
          const negative = p.status === "update_requested" || p.status === "rejected"
          return (
            <li key={p.phase} className="grid gap-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className={cx("size-2.5 shrink-0 rounded-full", REVIEW_STATUS_DOT[p.status])} aria-hidden />
                <span className="text-[0.95rem] font-extrabold text-navy">
                  {p.phase === "DESIGN" ? "Design" : "Build"}
                </span>
                <Chip tone={reviewChipTone(p.status)}>{REVIEW_STATUS_TEXT[p.status]}</Chip>
                {p.reviewedAt !== null && (
                  <span className="hand text-[0.82rem] text-navy-soft">decided {fmtDate(p.reviewedAt)}</span>
                )}
              </div>

              {p.comments && (
                <p className="rounded-xl bg-cream px-3.5 py-2.5 text-[0.9rem] leading-snug text-navy-soft">
                  {p.comments}
                </p>
              )}

              {p.disputedAt !== null ? (
                <p className="hand text-[0.84rem] text-navy-soft">
                  {p.disputeResolved
                    ? `a second look was taken on ${fmtDate(p.disputedAt)}.`
                    : `you asked for a second look on ${fmtDate(p.disputedAt)}; a reviewer will read it again.`}
                </p>
              ) : negative ? (
                <div className="flex flex-wrap items-center gap-2">
                  {p.status === "update_requested" && (
                    <Button
                      variant="solid"
                      size="sm"
                      onClick={() => setOpenCheckpoint(warmup ? `wu-${projectId}-submit` : `w${weekFor(p.phase)}-submit`)}
                    >
                      I&apos;ve made these changes — resubmit
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setDisputing(p.phase)}>
                    This review is incorrect
                  </Button>
                </div>
              ) : null}

              {disputing === p.phase && (
                <DisputeForm projectId={projectId} phase={p.phase} onClose={() => setDisputing(null)} />
              )}
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

export function ProjectDetail({ id, data }: { id: string; data: ProjectPageData | null }) {
  const { projects, stateOf, weekOf, warmupWeekOf, weekHours, hydrated, unsubmitPhase } = useStore()
  const project = projects.find((p) => p.id === id)

  // A miss here is real: the id is someone else's, or the project was deleted.
  if (!project || !data) {
    const missing = hydrated || !data
    return (
      <div className="mx-auto w-full max-w-[960px] px-4 pt-6 sm:px-8">
        <BackLink />
        <Panel tone="line" radius={20} className="mt-6 bg-paper px-6 py-14 text-center">
          <p className="text-[1.05rem] font-extrabold text-navy">{missing ? "No such project" : "Loading…"}</p>
          {missing && (
            <p className="hand mx-auto mt-2 max-w-[40ch] text-[0.9rem] text-navy-soft">
              it may have been deleted, or it belongs to someone else.
            </p>
          )}
        </Panel>
      </div>
    )
  }

  const warmup = project.weekId === WARMUP_WEEK_ID
  // A warm-up has a week of its own, found by project: several share week 0.
  const week = (warmup ? warmupWeekOf(project.id) : null) ?? weekOf(project.weekId)
  const buildWeekId = project.weekId + DESIGN_WEEKS
  const weekFor = (phase: "DESIGN" | "BUILD") =>
    warmup ? WARMUP_WEEK_ID : phase === "DESIGN" ? project.weekId : buildWeekId

  const sessions = data.timeline.flatMap((t) => (t.kind === "session" ? [t] : []))
  const hours = sessions.reduce((n, s) => n + (s.approvedHours ?? s.hours), 0)
  const started = data.timeline.at(-1)?.at ?? 0

  // The tier stops being editable the moment the design week is handed in —
  // that submission is what claimed it, and the build week only inherits it.
  // A warm-up's one submit claims it the same way.
  const submit = week.checkpoints.find((c) => c.kind === "submit")
  const submitted = submit ? stateOf(submit.id).done : false
  const grantUsd = TIERS.find((t) => t.id === project.tier)?.grantUsd ?? 0
  // Kept in a local so the phase survives into the unsubmit handler below.
  const inReview = data.inReview

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pt-6 pb-10 sm:px-8">
      <BackLink />

      {/* ---------- the project itself ---------- */}
      {/* Sized by its own width, not the viewport's: the rails either side of
          the page take a different share at every breakpoint, and the header
          only has room for two columns once it is wide enough for both. Below
          that the thumbnail leads as a banner, and it is first in the DOM so
          focus order agrees with what is seen. */}
      <Panel tone="line" radius={22} className="@container mt-5 bg-paper px-5 py-5 sm:px-7 sm:py-6">
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_260px] @3xl:gap-8">
          <CoverImage
            projectId={project.id}
            url={data.coverImageUrl}
            fallback={data.fallbackThumbnail}
            theme={week.theme}
            accent={week.accent}
            locked={data.editLocked}
          />
          <div className="min-w-0 @3xl:col-start-1 @3xl:row-start-1">
            <ProjectDetails
              project={project}
              // A warm-up project's hours live in its imported session, not in
              // a trail week, so its tier hint reads the timeline total.
              hours={warmup ? hours : weekHours(project.weekId)}
              tierLocked={submitted}
              locked={data.editLocked}
              unsubmit={
                inReview
                  ? {
                      label: warmup ? "this warm-up project" : `week ${weekFor(inReview)}`,
                      // A warm-up project has no checkpoint of its own to
                      // address it by (several share week 0), so it names
                      // itself; a season week resolves through its checkpoint.
                      run: () =>
                        unsubmitPhase(
                          warmup ? { projectId: project.id, phase: inReview } : `w${weekFor(inReview)}-submit`,
                        ),
                    }
                  : undefined
              }
              // Two lines, one voice: how far it has got, then what it is.
              // Everything else the page knows about it is further down, where
              // it can be acted on.
              meta={
                <div className="hand mt-4 grid gap-1 text-[0.84rem] text-navy-soft">
                  <p className="flex flex-wrap items-center gap-x-2 tabular-nums">
                    <span className="inline-flex items-center gap-1.5 text-teal-ink">
                      <IconClock className="text-sm" /> {fmtHours(hours)} logged
                    </span>
                    <Dot />
                    <span>{sessions.length === 1 ? "1 entry" : `${sessions.length} entries`}</span>
                    {started > 0 && (
                      <>
                        <Dot />
                        <span>started {fmtDate(started)}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                    <Chip tone="muted">{warmup ? "Warm Up" : week.theme}</Chip>
                    <Chip tone="violet">
                      Tier {project.tier}
                      {project.starter && " · starter"}
                    </Chip>
                    {!warmup && (
                      <span>
                        weeks {project.weekId} &amp; {buildWeekId}
                      </span>
                    )}
                    {project.githubRepo && (
                      <>
                        <Dot />
                        <a
                          href={project.githubRepo}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={project.githubRepo}
                          className="min-w-0 truncate text-navy underline decoration-line-strong decoration-dashed underline-offset-4 transition-colors hover:decoration-violet"
                        >
                          {displayRepo(project.githubRepo)}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              }
            />
          </div>
        </div>
      </Panel>

      {/* ---------- the warm-up's work, and its one hand-in ---------- */}
      {warmup && <WarmupWork projectId={project.id} />}

      {/* ---------- where review stands ---------- */}
      {data.phases.length > 0 && (
        <Section id="review-title" title="Review">
          <ReviewState projectId={project.id} phases={data.phases} weekFor={weekFor} warmup={warmup} />
        </Section>
      )}

      {/* ---------- what the repo has ---------- */}
      <div className="mt-6">
        <RepoChecks project={project} onResult={noop} editable={false} />
      </div>

      <HackatimeLinks projectId={project.id} phase={week.phase} />

      {/* ---------- the parts ---------- */}
      <Section id="bom-title" title="Bill of materials">
        <Panel tone="line" radius={20} className="bg-paper px-5 py-5 sm:px-6">
          <BomEditor
            projectId={project.id}
            items={data.bom}
            taxShippingUsd={data.bomTaxShippingUsd}
            locked={data.bomLocked}
            tier={project.tier}
            grantUsd={grantUsd}
          />
        </Panel>
      </Section>

      {/* ---------- what happened, newest first ---------- */}
      <Section id="timeline-title" title="Timeline">
        <Panel tone="line" radius={20} className="bg-paper px-5 py-6 sm:px-6">
          {data.timeline.length === 0 ? (
            <p className="hand py-8 text-center text-[0.9rem] text-navy-soft">
              nothing on the record yet. Journal entries, timelapses and reels land here as you log them.
            </p>
          ) : (
            <Timeline items={data.timeline} weekFor={weekFor} />
          )}
        </Panel>
      </Section>
    </div>
  )
}

// Stable, so the repo checks do not re-run on every render of the page.
function noop() {}

function Dot() {
  return (
    <span aria-hidden="true" className="text-navy-faint">
      ·
    </span>
  )
}
