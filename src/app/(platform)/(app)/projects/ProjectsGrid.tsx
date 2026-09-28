"use client"

import Link from "next/link"
import type { PhaseStatus } from "@/app/generated/prisma/enums"
import { WeekScene } from "@/components/platform/art"
import { IconArrowRight, IconClock, IconFilm, IconPencil } from "@/components/platform/icons"
import { RepoEditor } from "@/components/platform/RepoField"
import { Chip, cx, Panel } from "@/components/platform/ui"
import { fmtDate, fmtHours, projectEvents, projectStats } from "@/lib/projects"
import { REVIEW_STATUS_DOT, REVIEW_STATUS_TEXT, reviewTone } from "@/lib/review-state"
import { PLATFORM_HOME } from "@/lib/routes"
import { useStore } from "@/lib/store"

/** One phase's state, said in words as well as colour. */
function PhaseChip({ phase, status }: { phase: string; status: PhaseStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[0.72rem] font-semibold text-navy-soft">
      <span className={cx("size-2 shrink-0 rounded-full", REVIEW_STATUS_DOT[status])} aria-hidden />
      {phase} {REVIEW_STATUS_TEXT[status]}
    </span>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("size-2.5 rounded-full", className)} aria-hidden />
      {label}
    </span>
  )
}

export function ProjectsGrid() {
  const { projects, weeks, stateOf, weekOf } = useStore()

  if (projects.length === 0) {
    return (
      <Panel tone="line" radius={20} className="bg-paper px-6 py-14 text-center">
        <WeekScene theme="PCB" className="mx-auto h-24 w-auto opacity-40" />
        <p className="mt-5 text-[1.05rem] font-extrabold text-navy">Nothing here yet</p>
        <p className="hand mx-auto mt-2 max-w-[44ch] text-[0.9rem] leading-relaxed text-navy-soft">
          your first project gets made at the yellow checkpoint. everything you log against it collects here.
        </p>
        <Link
          href={PLATFORM_HOME}
          className="label mt-6 inline-flex items-center gap-1.5 rounded-full border-2 border-line px-4 py-2 text-navy-soft transition-colors hover:border-navy hover:text-navy"
        >
          Go to the trail <IconArrowRight className="text-base" />
        </Link>
      </Panel>
    )
  }

  const anyReviewState = projects.some((p) => reviewTone(p.designStatus, p.buildStatus) !== "line")

  return (
    <>
      {anyReviewState && (
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.78rem] text-navy-soft">
          <span className="label text-line-strong">Review</span>
          <Legend className="bg-teal" label="Approved" />
          <Legend className="bg-sky" label="In review" />
          <Legend className="bg-orange" label="Needs changes" />
          <Legend className="bg-coral" label="Rejected" />
        </div>
      )}

      <ul className="grid gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => {
          const week = weekOf(project.weekId)
          const events = projectEvents(project, weeks, stateOf)
          const stats = projectStats(events)
          const tone = reviewTone(project.designStatus, project.buildStatus)

          return (
            <Panel key={project.id} as="li" tone={tone} radius={20} className="flex flex-col overflow-hidden bg-paper">
              <Link href={`/projects/${project.id}`} className="group flex flex-1 flex-col">
                <span
                  className={cx(
                    "relative grid aspect-[16/9] place-items-center overflow-hidden",
                    !project.thumbnailUrl && "p-4",
                  )}
                  style={{ background: project.thumbnailUrl ? "var(--color-navy)" : week.accent }}
                >
                  {project.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- R2 or a URL the maker pasted into a journal
                    <img
                      src={project.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  ) : (
                    <WeekScene
                      theme={week.theme}
                      className="h-full w-auto max-w-full drop-shadow-md transition-transform duration-300 group-hover:scale-[1.04]"
                    />
                  )}
                  <span className="label absolute top-2.5 left-2.5 rounded-full bg-white/90 px-2.5 py-1 text-navy">
                    Week {week.id}
                  </span>
                </span>

                <span className="flex flex-1 flex-col px-4 py-4">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 text-[1.05rem] leading-tight font-extrabold [overflow-wrap:anywhere] text-navy group-hover:underline group-hover:decoration-2 group-hover:underline-offset-4">
                      {project.name}
                    </span>
                    <Chip tone="violet">Tier {project.tier}</Chip>
                  </span>

                  <span className="mt-1.5 line-clamp-2 text-[0.85rem] leading-snug [overflow-wrap:anywhere] text-navy-soft">
                    {project.description}
                  </span>

                  {/* Only the phases that have left draft: a fresh project's
                      card stays quiet. */}
                  {(project.designStatus !== "draft" || project.buildStatus !== "draft") && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {project.designStatus !== "draft" && <PhaseChip phase="Design" status={project.designStatus} />}
                      {project.buildStatus !== "draft" && <PhaseChip phase="Build" status={project.buildStatus} />}
                    </span>
                  )}

                  <span className="mt-auto flex flex-wrap items-center gap-x-3.5 gap-y-1 pt-3.5">
                    <span className="hand inline-flex items-center gap-1.5 text-[0.8rem] text-navy-soft tabular-nums">
                      <IconClock className="text-sm" /> {fmtHours(stats.hours)}
                    </span>
                    <span className="hand inline-flex items-center gap-1.5 text-[0.8rem] text-navy-soft tabular-nums">
                      <IconPencil className="text-sm" /> {stats.sessions}
                    </span>
                    <span className="hand inline-flex items-center gap-1.5 text-[0.8rem] text-navy-soft tabular-nums">
                      <IconFilm className="text-sm" /> {stats.reels}
                    </span>
                    {stats.started > 0 && (
                      <span className="hand ml-auto text-[0.76rem] text-line-strong">{fmtDate(stats.started)}</span>
                    )}
                  </span>
                </span>
              </Link>
              {/* Outside the card's link, so editing the repo is not a click
                  through to the project page and the link inside it is not a
                  link nested in a link. */}
              <RepoEditor project={project} className="border-t border-line/70 px-4 py-2.5" />
            </Panel>
          )
        })}
      </ul>
    </>
  )
}
