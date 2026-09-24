"use client";

import Link from "next/link";
import { WeekScene } from "@/components/platform/art";
import { IconChevronLeft, IconClock } from "@/components/platform/icons";
import { Chip, Panel } from "@/components/platform/ui";
import { WEEK_META } from "@/lib/curriculum";
import { DESIGN_WEEKS } from "@/lib/config/printers";
import { fmtHours } from "@/lib/projects";
import type { PublicProjectData } from "@/lib/queries/project-page";
import { Timeline } from "./Timeline";

/**
 * Someone else's project: what it is, and the story of it, and nothing to
 * edit. The owner's page reads the trail's store for its name and weeks; this
 * one cannot — the store only holds the viewer's own projects — so everything
 * on it comes from the server in `data`.
 */
export function PublicProjectDetail({ data }: { data: PublicProjectData }) {
  const week = WEEK_META.find((w) => w.id === data.weekId) ?? WEEK_META[0];
  const buildWeekId = data.weekId + DESIGN_WEEKS;
  const weekFor = (phase: "DESIGN" | "BUILD") => (phase === "DESIGN" ? data.weekId : buildWeekId);

  const sessions = data.timeline.flatMap((t) => (t.kind === "session" ? [t] : []));
  const hours = sessions.reduce((n, s) => n + (s.approvedHours ?? s.hours), 0);

  return (
    <div className="mx-auto w-full max-w-[960px] px-4 pt-6 pb-10 sm:px-8">
      <Link
        href="/explore"
        className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
      >
        <IconChevronLeft className="text-base" /> Explore
      </Link>

      <Panel tone="line" radius={22} className="@container mt-5 bg-paper px-5 py-5 sm:px-7 sm:py-6">
        <div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_260px] @3xl:gap-8">
          <div
            className="relative grid aspect-[21/9] place-items-center overflow-hidden rounded-2xl @3xl:col-start-2 @3xl:aspect-[4/3]"
            style={{ background: data.thumbnailUrl ? "var(--color-navy)" : week?.accent }}
          >
            {data.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- R2 or a URL pasted into a journal
              <img src={data.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <WeekScene theme={week?.theme ?? "PCB"} className="h-full w-auto max-w-full p-5 drop-shadow-lg" />
            )}
          </div>
          <div className="min-w-0 @3xl:col-start-1 @3xl:row-start-1">
            <p className="label text-navy-soft">by {data.author}</p>
            <h1 className="mt-1 text-[1.6rem] leading-tight font-extrabold tracking-[-0.02em] [overflow-wrap:anywhere] text-navy sm:text-[1.9rem]">
              {data.title}
            </h1>
            {data.description && (
              <p className="mt-2 max-w-[60ch] text-[0.95rem] leading-relaxed [overflow-wrap:anywhere] text-navy-soft">
                {data.description}
              </p>
            )}
            {/* The owner's page says the same two things the same way. */}
            <div className="hand mt-4 grid gap-1 text-[0.84rem] text-navy-soft tabular-nums">
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="inline-flex items-center gap-1.5 text-teal-deep">
                  <IconClock className="text-sm" /> {fmtHours(hours)} logged
                </span>
                <span aria-hidden="true" className="text-line-strong">·</span>
                <span>{sessions.length === 1 ? "1 entry" : `${sessions.length} entries`}</span>
              </p>
              {week && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <Chip tone="muted">{week.theme}</Chip>
                  <span>
                    weeks {data.weekId} &amp; {buildWeekId}
                  </span>
                </p>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <section aria-labelledby="timeline-title" className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="timeline-title" className="label text-violet-deep">
            Timeline
          </h2>
          {data.timeline.length > 0 && <span className="hand text-[0.84rem] text-navy-soft">newest first</span>}
        </div>
        <Panel tone="line" radius={20} className="bg-paper px-5 py-6 sm:px-6">
          {data.timeline.length === 0 ? (
            <p className="hand py-8 text-center text-[0.9rem] text-navy-soft">nothing on the record yet.</p>
          ) : (
            <Timeline items={data.timeline} weekFor={weekFor} />
          )}
        </Panel>
      </section>
    </div>
  );
}
