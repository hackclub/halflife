"use client";

import Link from "next/link";
import { IconChevronLeft, IconClock, IconFilm, IconPencil, IconPlay } from "@/components/platform/icons";
import { RepoChecks } from "@/components/platform/modals/RepoChecks";
import { Chip, Panel } from "@/components/platform/ui";
import { TIERS } from "@/lib/curriculum";
import { DESIGN_WEEKS } from "@/lib/config/printers";
import { fmtDate, fmtHours } from "@/lib/projects";
import type { ProjectPageData } from "@/lib/queries/project-page";
import { useStore } from "@/lib/store";
import { BomEditor } from "./BomEditor";
import { HackatimeLinks } from "./HackatimeLinks";
import { CoverImage } from "./ProjectHeaderParts";
import { ProjectDetails } from "./ProjectDetails";
import { Timeline } from "./Timeline";

function BackLink() {
  return (
    <Link
      href="/projects"
      className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
    >
      <IconChevronLeft className="text-base" /> All projects
    </Link>
  );
}

/** A titled section of the page. */
function Section({
  title,
  aside,
  children,
  id,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  id: string;
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
  );
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
export function ProjectDetail({ id, data }: { id: string; data: ProjectPageData | null }) {
  const { projects, stateOf, weekOf, weekHours, hydrated } = useStore();
  const project = projects.find((p) => p.id === id);

  // A miss here is real: the id is someone else's, or the project was deleted.
  if (!project || !data) {
    const missing = hydrated || !data;
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
    );
  }

  const week = weekOf(project.weekId);
  const buildWeekId = project.weekId + DESIGN_WEEKS;
  const weekFor = (phase: "DESIGN" | "BUILD") => (phase === "DESIGN" ? project.weekId : buildWeekId);

  const sessions = data.timeline.flatMap((t) => (t.kind === "session" ? [t] : []));
  const lapses = sessions.reduce((n, s) => n + s.lapses.length, 0);
  const reels = data.timeline.filter((t) => t.kind === "reel").length;
  const hours = sessions.reduce((n, s) => n + (s.approvedHours ?? s.hours), 0);
  const started = data.timeline.at(-1)?.at ?? 0;

  // The tier stops being editable the moment the design week is handed in —
  // that submission is what claimed it, and the build week only inherits it.
  const submit = week.checkpoints.find((c) => c.kind === "submit");
  const submitted = submit ? stateOf(submit.id).done : false;
  const grantUsd = TIERS.find((t) => t.id === project.tier)?.grantUsd ?? 0;

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
              stats={
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="hand inline-flex items-center gap-1.5 text-[0.84rem] text-teal-deep tabular-nums">
                    <IconClock className="text-sm" /> {fmtHours(hours)} logged
                  </span>
                  <span className="hand inline-flex items-center gap-1.5 text-[0.84rem] text-navy-soft tabular-nums">
                    <IconPencil className="text-sm" />
                    {sessions.length === 1 ? "1 journal entry" : `${sessions.length} journal entries`}
                  </span>
                  <span className="hand inline-flex items-center gap-1.5 text-[0.84rem] text-navy-soft tabular-nums">
                    <IconPlay className="text-sm" />
                    {lapses === 1 ? "1 timelapse" : `${lapses} timelapses`}
                  </span>
                  <span className="hand inline-flex items-center gap-1.5 text-[0.84rem] text-navy-soft tabular-nums">
                    <IconFilm className="text-sm" />
                    {reels === 1 ? "1 reel" : `${reels} reels`}
                  </span>
                  {started > 0 && (
                    <span className="hand text-[0.84rem] text-navy-soft">started {fmtDate(started)}</span>
                  )}
                </p>
              }
              chips={
                <div className="mt-4 flex flex-wrap gap-2">
                  <Chip tone="muted">{week.fullName}</Chip>
                  <Chip tone="muted">
                    Weeks {project.weekId} and {buildWeekId}
                  </Chip>
                  {project.starter && <Chip tone="gold">Starter project</Chip>}
                </div>
              }
            />
          </div>
        </div>
      </Panel>

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
      <Section
        id="timeline-title"
        title="Timeline"
        aside={
          data.timeline.length > 0 && <span className="hand text-[0.84rem] text-navy-soft">newest first</span>
        }
      >
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
  );
}

// Stable, so the repo checks do not re-run on every render of the page.
function noop() {}
