"use client"

import Link from "next/link"
import { WeekPainting } from "@/components/platform/art"
import { IconChevronLeft, IconClock } from "@/components/platform/icons"
import { ProjectThumb } from "@/components/platform/ProjectThumb"
import { ReportButton } from "@/components/platform/report/ReportButton"
import { Chip, Panel } from "@/components/platform/ui"
import { DESIGN_WEEKS } from "@/lib/config/printers"
import { WARMUP_THEME, WARMUP_WEEK_ID } from "@/lib/config/program"
import { WEEK_META } from "@/lib/curriculum"
import { fmtHours } from "@/lib/projects"
import type { PublicProjectData } from "@/lib/queries/project-page"
import { Timeline } from "./Timeline"

/**
 * Someone else's project: what it is, and the story of it, and nothing to
 * edit. The owner's page reads the trail's store for its name and weeks; this
 * one cannot – the store only holds the viewer's own projects – so everything
 * on it comes from the server in `data`.
 */
export function PublicProjectDetail({ data }: { data: PublicProjectData }) {
	const warmup = data.weekId === WARMUP_WEEK_ID
	const week = WEEK_META.find((w) => w.id === data.weekId) ?? WEEK_META[0]
	const buildWeekId = data.weekId + DESIGN_WEEKS
	const weekFor = (phase: "DESIGN" | "BUILD") =>
		warmup ? WARMUP_WEEK_ID : phase === "DESIGN" ? data.weekId : buildWeekId

	const sessions = data.timeline.flatMap((t) => (t.kind === "session" ? [t] : []))
	const hours = sessions.reduce((n, s) => n + (s.approvedHours ?? s.hours), 0)

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
						style={{
							background: data.thumbnail ? "var(--color-navy)" : warmup ? "var(--color-violet-pale)" : week?.accent,
						}}
					>
						{data.thumbnail ? (
							<ProjectThumb thumb={data.thumbnail} className="h-full w-full" />
						) : (
							<WeekPainting
								theme={warmup ? WARMUP_THEME.label : (week?.theme ?? "PCB")}
								alt=""
								sizes="(min-width: 768px) 360px, 50vw"
								className="sticker-shadow aspect-square h-[82%] max-w-full"
							/>
						)}
					</div>
					<div className="min-w-0 @3xl:col-start-1 @3xl:row-start-1">
						<p className="label text-navy-soft">
							by{" "}
							<Link
								href={`/u/${data.authorId}`}
								className="text-navy-soft hover:text-navy hover:underline hover:decoration-dashed hover:underline-offset-4"
							>
								{data.author}
							</Link>{" "}
							<span aria-hidden="true" className="text-navy-faint">
								·
							</span>{" "}
							<ReportButton
								target={{ type: "PROJECT", id: data.id }}
								title="Report this project"
								context={data.description || data.title}
							/>
						</p>
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
								<span className="inline-flex items-center gap-1.5 text-teal-ink">
									<IconClock className="text-sm" /> {fmtHours(hours)} logged
								</span>
								<span aria-hidden="true" className="text-navy-faint">
									·
								</span>
								<span>{sessions.length === 1 ? "1 entry" : `${sessions.length} entries`}</span>
							</p>
							<p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
								<Chip tone="muted">{warmup ? "Warm Up" : (week?.theme ?? "PCB")}</Chip>
								{!warmup && (
									<span>
										weeks {data.weekId} &amp; {buildWeekId}
									</span>
								)}
							</p>
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
						<Timeline items={data.timeline} weekFor={weekFor} allowReport />
					)}
				</Panel>
			</section>
		</div>
	)
}
