"use client"

import Link from "next/link"
import { IconChevronLeft, IconClock } from "@/components/platform/icons"
import { RepoChecks } from "@/components/platform/modals/RepoChecks"
import { Chip, cx, Panel } from "@/components/platform/ui"
import { DESIGN_WEEKS } from "@/lib/config/printers"
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

/** Where each phase stands with review, above the repo checks. */
function ReviewState({ phases }: { phases: ProjectPageData["phases"] }) {
  return (
    <Panel tone="line" radius={20} className="bg-paper px-5 py-5 sm:px-6">
      <ul className="grid gap-4">
        {phases.map((p) => (
          <li key={p.phase} className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className={cx("size-2.5 shrink-0 rounded-full", REVIEW_STATUS_DOT[p.status])} aria-hidden />
            <span className="text-[0.95rem] font-extrabold text-navy">{p.phase === "DESIGN" ? "Design" : "Build"}</span>
            <Chip tone={reviewChipTone(p.status)}>{REVIEW_STATUS_TEXT[p.status]}</Chip>
            {p.reviewedAt !== null && (
              <span className="hand text-[0.82rem] text-navy-soft">decided {fmtDate(p.reviewedAt)}</span>
            )}
            {p.comments && (
              <p className="basis-full rounded-xl bg-cream px-3.5 py-2.5 text-[0.9rem] leading-snug text-navy-soft">
                {p.comments}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export function ProjectDetail({ id, data }: { id: string; data: ProjectPageData | null }) {
  const { projects, stateOf, weekOf, weekHours, hydrated, unsubmitPhase } = useStore()
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

  const week = weekOf(project.weekId)
  const buildWeekId = project.weekId + DESIGN_WEEKS
  const weekFor = (phase: "DESIGN" | "BUILD") => (phase === "DESIGN" ? project.weekId : buildWeekId)

  const sessions = data.timeline.flatMap((t) => (t.kind === "session" ? [t] : []))
  const hours = sessions.reduce((n, s) => n + (s.approvedHours ?? s.hours), 0)
  const started = data.timeline.at(-1)?.at ?? 0

  // The tier stops being editable the moment the design week is handed in —
  // that submission is what claimed it, and the build week only inherits it.
  const submit = week.checkpoints.find((c) => c.kind === "submit")
  const submitted = submit ? stateOf(submit.id).done : false
  const grantUsd = TIERS.find((t) => t.id === project.tier)?.grantUsd ?? 0

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
            fallbackUrl={data.journalImageUrl}
            theme={week.theme}
            accent={week.accent}
            locked={data.editLocked}
          />
          <div className="min-w-0 @3xl:col-start-1 @3xl:row-start-1">
            <ProjectDetails
              project={project}
              hours={weekHours(project.weekId)}
              tierLocked={submitted}
              locked={data.editLocked}
              unsubmit={
                data.inReview
                  ? {
                      week: weekFor(data.inReview),
                      run: () => unsubmitPhase(`w${weekFor(data.inReview ?? "DESIGN")}-submit`),
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
                    <Chip tone="muted">{week.theme}</Chip>
                    <Chip tone="violet">
                      Tier {project.tier}
                      {project.starter && " · starter"}
                    </Chip>
                    <span>
                      weeks {project.weekId} &amp; {buildWeekId}
                    </span>
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

      {/* ---------- where review stands ---------- */}
      {data.phases.length > 0 && (
        <Section id="review-title" title="Review">
          <ReviewState phases={data.phases} />
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
