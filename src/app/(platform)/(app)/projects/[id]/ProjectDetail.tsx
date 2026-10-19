"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { DisputeThread } from "@/app/components/forms/DisputeThread"
import { IconBook, IconChevronLeft, IconClock, IconWarning } from "@/components/platform/icons"
import { RepoChecks } from "@/components/platform/modals/RepoChecks"
import { RepoSyncSettings } from "@/components/platform/RepoSyncSettings"
import { Button, Chip, Panel } from "@/components/platform/ui"
import { getStarterProject } from "@/lib/config/onboarding"
import { DESIGN_WEEKS } from "@/lib/config/printers"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import { TIERS } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { fmtDate, fmtHours } from "@/lib/projects"
import type { ProjectPageData } from "@/lib/queries/project-page"
import { displayRepo } from "@/lib/repo"
import { REVIEW_STATUS_DOT, REVIEW_STATUS_TEXT, reviewChipTone } from "@/lib/review-state"
import { useStore } from "@/lib/store"
import type { Project } from "@/lib/types"
import { BomEditor } from "./BomEditor"
import { HackatimeLinks } from "./HackatimeLinks"
import { ProjectDetails } from "./ProjectDetails"
import { CoverImage } from "./ProjectHeaderParts"
import { Timeline } from "./Timeline"

function BackLink() {
	return (
		<Link
			className="label inline-flex items-center gap-1.5 text-navy-soft transition-colors hover:text-navy"
			href="/projects"
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
				<h2 className="label text-violet-deep" id={id}>
					{title}
				</h2>
				{aside}
			</div>
			{children}
		</section>
	)
}

/**
 * One project, laid out the way Stasis lays out its project page: what it is at the top with its thumbnail beside it, then what the repo has, the hours tracked elsewhere, the parts list, and last the full record of the work – every entry, timelapse, reel and review, newest first.
 *
 * The store supplies the project's name, tier and weeks, as it does for every page; the server supplies the rest in `data`, because the timeline's media and the parts list are only ever wanted here.
 */

/** Ask a reviewer to read a decision again. Changes no state. */
function DisputeForm({ projectId, phase, onClose }: { projectId: string; phase: "DESIGN" | "BUILD"; onClose(): void }) {
	const router = useRouter()
	const [note, setNote] = useState("")
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function submit() {
		if (saving) return
		if (note.trim().length < 10) return setError("Tell us what looks wrong – a sentence is enough.")
		setSaving(true)
		setError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}/dispute`, {
				body: JSON.stringify({ note: note.trim(), phase }),
				headers: { "content-type": "application/json" },
				method: "POST",
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
			<label className="label text-violet-deep" htmlFor={`dispute-${phase}`}>
				What looks wrong?{" "}
				<span className="hand font-normal normal-case text-navy-soft">(a sentence is enough, 10+ characters)</span>
			</label>
			<textarea
				className="block w-full rounded-xl border-2 border-field bg-white px-3.5 py-2.5 text-[0.9rem] text-navy outline-none placeholder:text-navy-faint transition-colors hover:border-navy-soft focus:border-violet"
				id={`dispute-${phase}`}
				maxLength={2000}
				onChange={e => {
					setNote(e.target.value)
					if (error) setError(null)
				}}
				placeholder="The build works – the video runs at 1:20."
				rows={3}
				value={note}
			/>
			<p aria-live="polite" className="hand text-right text-[0.76rem] text-navy-soft tabular-nums">
				{note.trim().length}/10 minimum
			</p>
			{error && (
				<p className="text-[0.82rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			)}
			<div className="flex flex-wrap gap-2">
				<Button disabled={saving} onClick={() => submit()} size="sm" variant="solid">
					{saving ? "Sending…" : "Ask for a second look"}
				</Button>
				<Button disabled={saving} onClick={onClose} size="sm" variant="ghost">
					Cancel
				</Button>
			</div>
			<p className="hand text-[0.8rem] text-navy-soft">
				this does not change the decision – it asks a reviewer to read it again.
			</p>
		</div>
	)
}

/**
 * Delete the project, behind a second click. The server decides what may go (`deleteBlockReason`); `blocked` is that answer, so a project that cannot be deleted says why instead of offering a button that would refuse.
 */
function DeleteProject({ projectId, name, blocked }: { projectId: string; name: string; blocked: string | null }) {
	const router = useRouter()
	const [confirming, setConfirming] = useState(false)
	const [deleting, setDeleting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	async function remove() {
		setDeleting(true)
		setError(null)
		try {
			const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" })
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `That did not delete (${res.status})`)
				setDeleting(false)
				return
			}
			// Left in the deleting state: the page is on its way out.
			router.push("/projects")
			router.refresh()
		} catch {
			setError("Could not reach the server. Try again.")
			setDeleting(false)
		}
	}

	return (
		<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
			<p className="text-[0.9rem] leading-snug text-navy-soft">
				Takes it off your trail and your projects. Its journal entries stop counting toward your hours and streak. Reels
				you posted stay in the feed.
			</p>
			{blocked ? (
				<p className="hand mt-3 text-[0.84rem] text-navy-soft">{blocked}.</p>
			) : confirming ? (
				<div className="mt-3.5 grid gap-2.5">
					<p className="text-[0.9rem] font-extrabold text-navy">Delete {name}? You can&apos;t undo this yourself.</p>
					<div className="flex flex-wrap gap-2">
						<Button disabled={deleting} onClick={() => remove()} size="sm" variant="coral">
							{deleting ? "Deleting…" : "Yes, delete it"}
						</Button>
						<Button disabled={deleting} onClick={() => setConfirming(false)} size="sm" variant="ghost">
							Cancel
						</Button>
					</div>
				</div>
			) : (
				<Button className="mt-3.5" onClick={() => setConfirming(true)} size="sm" variant="outline">
					Delete project
				</Button>
			)}
			{error && (
				<p className="mt-2.5 text-[0.82rem] font-semibold text-coral-deep" role="alert">
					{error}
				</p>
			)}
		</Panel>
	)
}

/**
 * The warm-up's own trail, flattened onto its page: what it has logged against what submitting asks, the next entry to write, and its one submit. The sheets these open are the season's own journal and submit sheets, run on the warm-up's week 0, so writing and handing in work the same way everywhere.
 */
function WarmupWork({ projectId }: { projectId: string }) {
	const { warmupWeekOf, hoursOf, passedOf, statusOf, deadlineOf, stateOf, setOpenCheckpoint, projects } = useStore()
	const warmupWeek = warmupWeekOf(projectId)
	if (!warmupWeek) return null
	const project = projects.find(p => p.id === projectId)

	const build = warmupWeek.phase === "build"
	const hours = hoursOf(warmupWeek)
	const need = warmupWeek.submitHours
	const status = statusOf(warmupWeek)
	const handedIn = status === "in_review" || status === "approved" || status === "rejected"
	const passed = passedOf(warmupWeek)
	const deadline = deadlineOf(warmupWeek)
	const submitId = `wu-${projectId}-submit`

	const entries = warmupWeek.checkpoints.filter(c => c.kind === "journal")
	const written = entries.filter(c => stateOf(c.id).done)
	const next = entries.find(c => !stateOf(c.id).done)
	// Once the journal has closed, what there is can still be handed in, as a season week that has passed can.
	const canSubmit = !handedIn && (hours >= need || (passed && hours > 0))
	const short = Math.max(0, need - hours)
	const hasCover = !!project?.coverImageKey
	const canActuallySubmit = canSubmit && hasCover

	return (
		<Section id="warmup-title" title="Warm-up">
			<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
				<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
					<p className="text-[0.95rem] font-extrabold text-navy tabular-nums">
						{fmtHours(hours)} logged
						<span className="font-semibold text-navy-soft">
							{" "}
							· {build ? "a finished build" : "a design"}, submit from {fmtHours(need)}
						</span>
					</p>
					{deadline && (
						<p className="hand text-[0.84rem] text-navy-soft">
							{passed ? `journal closed after ${deadline}` : `journal open until ${deadline}`}
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
								<Button onClick={() => setOpenCheckpoint(next.id)} variant="gold">
									Log a session
								</Button>
							)}
							<Button
								aria-describedby={canSubmit && !hasCover ? "warmup-cover-hint" : undefined}
								disabled={!canActuallySubmit}
								onClick={() => setOpenCheckpoint(submitId)}
								variant="solid"
							>
								{build ? "Submit your build" : "Submit your design"}
							</Button>
							{!canSubmit && short > 0 && (
								<span className="hand text-[0.84rem] text-navy-soft tabular-nums">
									{fmtHours(short)} more to submit
								</span>
							)}
							{canSubmit && !hasCover && (
								<span className="hand text-[0.84rem] text-coral-deep" id="warmup-cover-hint">
									Upload a photo or screenshot of the project to submit
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
								{written.map(c => (
									<button
										className="font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
										key={c.id}
										onClick={() => setOpenCheckpoint(c.id)}
										type="button"
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
	weekFor(phase: "DESIGN" | "BUILD"): number
	/** A warm-up project's submit sheet lives on week 0, whichever its phase. */
	warmup: boolean
}) {
	const { setOpenCheckpoint } = useStore()
	const [disputing, setDisputing] = useState<"DESIGN" | "BUILD" | null>(null)

	return (
		<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
			<ul className="grid gap-5">
				{phases.map(p => {
					const negative = p.status === "update_requested" || p.status === "rejected"
					return (
						<li className="grid gap-2.5" key={p.phase}>
							<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
								<span aria-hidden className={cx("size-2.5 shrink-0 rounded-full", REVIEW_STATUS_DOT[p.status])} />
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

							{p.shipError && (
								<div className="rounded-xl bg-coral/10 px-3.5 py-3">
									<p className="text-[0.88rem] font-extrabold text-coral-dark">This hand-in has not reached review</p>
									<p className="mt-1 text-[0.86rem] leading-snug text-navy-soft">{p.shipError}</p>
									<p className="mt-1 text-[0.86rem] leading-snug text-navy-soft">
										Fix that, then hand it in again – take the week back first if it is still in review.
									</p>
								</div>
							)}

							{p.dispute ? (
								<DisputeThread
									dispute={p.dispute}
									replyUrl={`/api/projects/${projectId}/dispute/${p.dispute.id}/messages`}
									viewer="maker"
								/>
							) : null}

							{negative && (
								<div className="flex flex-wrap items-center gap-2">
									{p.status === "update_requested" && (
										<Button
											onClick={() =>
												setOpenCheckpoint(warmup ? `wu-${projectId}-submit` : `w${weekFor(p.phase)}-submit`)
											}
											size="sm"
											variant="solid"
										>
											I&apos;ve made these changes – resubmit
										</Button>
									)}
									{!p.dispute && (
										<Button onClick={() => setDisputing(p.phase)} size="sm" variant="outline">
											This review is incorrect
										</Button>
									)}
								</div>
							)}

							{disputing === p.phase && (
								<DisputeForm onClose={() => setDisputing(null)} phase={p.phase} projectId={projectId} />
							)}
						</li>
					)
				})}
			</ul>
		</Panel>
	)
}

/**
 * What a returned phase needs, before anything else on the page.
 *
 * A return is the one review state a maker is expected to act on, but its note used to live only in the Review block below the project's own details – far enough down that "Design needs changes" on the projects page read as a change the project page never explained. This puts the same note and the resubmit action at the very top, so opening a project answers the question its card raised.
 *
 * Only phases returned for changes: an approved phase has nothing left to do and a rejected one cannot be resubmitted, so both keep their reason in the Review block below.
 */
function ChangesNeeded({
	phases,
	projectId,
	warmup,
	weekFor,
}: {
	phases: ProjectPageData["phases"]
	projectId: string
	/** A warm-up project's submit sheet lives on week 0, whichever its phase. */
	warmup: boolean
	weekFor(phase: "DESIGN" | "BUILD"): number
}) {
	const { setOpenCheckpoint } = useStore()
	const returned = phases.filter(p => p.status === "update_requested")
	if (returned.length === 0) return null

	return (
		<Panel className="mt-5 bg-gold-pale/70 px-5 py-5 sm:px-6" radius={20} tone="gold">
			<div className="flex items-start gap-2.5">
				<IconWarning className="mt-0.5 shrink-0 text-[1.15rem] text-gold-ink" />
				<div className="grid min-w-0 flex-1 gap-5">
					{returned.map(p => (
						<div className="min-w-0" key={p.phase}>
							<p className="text-[1.05rem] leading-tight font-extrabold text-navy">
								{p.phase === "DESIGN" ? "Design" : "Build"} needs changes
							</p>
							{p.comments ? (
								// Pre-lined, so a reviewer's own line breaks survive: their note is often a list, and reflowing it into one paragraph loses which request ended and the next began.
								<p className="mt-1.5 text-[0.92rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-navy">
									{p.comments}
								</p>
							) : (
								<p className="hand mt-1.5 text-[0.9rem] leading-relaxed text-navy-soft">
									no reason was recorded with this decision. If that looks wrong, dispute it from the Review section
									below.
								</p>
							)}
							<Button
								className="mt-3"
								onClick={() => setOpenCheckpoint(warmup ? `wu-${projectId}-submit` : `w${weekFor(p.phase)}-submit`)}
								size="sm"
								variant="solid"
							>
								I&apos;ve made these changes – resubmit
							</Button>
						</div>
					))}
				</div>
			</div>
		</Panel>
	)
}

/**
 * The guide a starter project is built from. Choosing a starter happens once, on the step that names the project, and the card carrying its guide is gone the moment that step is left – but the guide is what the whole build is worked from, so the project page keeps the door to it open.
 *
 * Only a starter whose id is still in the config has one: the imported starters predate the config and carry no guide URL, so they show nothing rather than a dead link.
 */
function StarterGuide({ project }: { project: Project }) {
	const starter = project.starterProjectId ? getStarterProject(project.starterProjectId) : undefined
	if (!starter) return null

	return (
		<Panel className="mt-6 bg-gold-pale/70 px-5 py-4 sm:px-6" radius={20} tone="gold">
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
				<div className="min-w-0 flex-1">
					<p className="label text-gold-ink">Starter project</p>
					<p className="mt-1.5 text-[0.92rem] leading-relaxed text-navy">
						You&rsquo;re building <strong className="font-extrabold">{project.name}</strong>. The guide walks you
						through every step, from the first part to the finished board.
					</p>
				</div>
				<a
					className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
					href={starter.guideUrl}
					rel="noopener noreferrer"
					target="_blank"
				>
					<IconBook className="text-[1rem]" /> Read the guide
				</a>
			</div>
		</Panel>
	)
}

export function ProjectDetail({ id, data }: { id: string; data: ProjectPageData | null }) {
	const {
		projects,
		weekOf,
		warmupWeekOf,
		weekHours,
		hoursOf,
		hydrated,
		unsubmitPhase,
		statusOf,
		overlapUnchecked: overlapUncheckedWeek,
	} = useStore()
	const project = projects.find(p => p.id === id)

	// A miss here is real: the id is someone else's, or the project was deleted.
	if (!project || !data) {
		const missing = hydrated || !data
		return (
			<div className="mx-auto w-full max-w-[960px] px-4 pt-6 sm:px-8">
				<BackLink />
				<Panel className="mt-6 bg-paper px-6 py-14 text-center" radius={20} tone="line">
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

	const sessions = data.timeline.flatMap(t => (t.kind === "session" ? [t] : []))
	// Journal sessions plus everything that arrived another way (Hackatime link time, reviewer adjustments) – the same accounting the sidebar total and the project cards read, so the three never disagree. A season project spans its design week and its build week.
	const hours = warmup ? hoursOf(week) : weekHours(project.weekId) + weekHours(buildWeekId)
	const started = data.timeline.at(-1)?.at ?? 0

	// The tier is final once the design decision is approved, not the moment it is handed in: a phase returned for changes is still the maker's to revise, and the week a return reopens is exactly when they would. The build week inherits the design's tier, and a warm-up's one submit claims it the same way.
	const tierLocked = statusOf(week) === "approved"
	const grantUsd = TIERS.find(t => t.id === project.tier)?.grantUsd ?? 0
	// Kept in a local so the phase survives into the unsubmit handler below.
	const inReview = data.inReview
	// The overlap between a recording and a Hackatime link could not be checked for a phase of this project, so the total on this page may still be counting the same sitting once through each. A season project spans its design and build weeks, five apart, so either of them is enough.
	const overlapUnchecked = overlapUncheckedWeek(project.weekId) || overlapUncheckedWeek(buildWeekId)

	return (
		<div className="mx-auto w-full max-w-[960px] px-4 pt-6 pb-10 sm:px-8">
			<BackLink />

			{/* ---------- what a return asks for, first ---------- */}
			<ChangesNeeded phases={data.phases} projectId={project.id} warmup={warmup} weekFor={weekFor} />

			{/* ---------- the project itself ---------- */}
			{/* Sized by its own width, not the viewport's: the rails either side of
          the page take a different share at every breakpoint, and the header
          only has room for two columns once it is wide enough for both. Below
          that the thumbnail leads as a banner, and it is first in the DOM so
          focus order agrees with what is seen. */}
			<Panel className="@container mt-5 bg-paper px-5 py-5 sm:px-7 sm:py-6" radius={22} tone="line">
				<div className="grid gap-5 @3xl:grid-cols-[minmax(0,1fr)_260px] @3xl:gap-8">
					<CoverImage
						accent={week.accent}
						fallback={data.fallbackThumbnail}
						locked={data.editLocked}
						projectId={project.id}
						theme={week.theme}
						url={data.coverImageUrl}
					/>
					<div className="min-w-0 @3xl:col-start-1 @3xl:row-start-1">
						<ProjectDetails
							// A warm-up project's hours live in its imported session, not in a trail week, so its tier hint reads the timeline total.
							hours={warmup ? hours : weekHours(project.weekId)}
							locked={data.editLocked}
							// Two lines, one voice: how far it has got, then what it is. Everything else the page knows about it is further down, where it can be acted on.
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
													className="min-w-0 truncate text-navy underline decoration-line-strong decoration-dashed underline-offset-4 transition-colors hover:decoration-violet"
													href={project.githubRepo}
													rel="noopener noreferrer"
													target="_blank"
													title={project.githubRepo}
												>
													{displayRepo(project.githubRepo)}
												</a>
											</>
										)}
									</p>
								</div>
							}
							project={project}
							tierLocked={tierLocked}
							unsubmit={
								inReview
									? {
											label: warmup ? "this warm-up project" : `week ${weekFor(inReview)}`,
											// A warm-up project has no checkpoint of its own to address it by (several share week 0), so it names itself; a season week resolves through its checkpoint.
											run: () =>
												unsubmitPhase(
													warmup ? { phase: inReview, projectId: project.id } : `w${weekFor(inReview)}-submit`,
												),
										}
									: undefined
							}
						/>
					</div>
				</div>
			</Panel>

			{/* The guide a starter is built from */}
			<StarterGuide project={project} />

			{/* A total that may still be counting one sitting twice has to say so here, where the number is read. Only the review screen carried this, so a participant whose tracked intervals could not be read saw the doubled figure presented as fact – which is the report this answers. */}
			{overlapUnchecked && (
				<Panel className="mt-5 bg-paper px-5 py-4" radius={18} tone="line">
					<p className="flex items-start gap-2 text-[0.88rem] leading-snug text-navy">
						<IconWarning className="mt-0.5 shrink-0 text-base text-gold-ink" />
						<span>
							The hours above might count one session twice. Where you recorded with Lapse, the same time also appears
							as Hackatime heartbeats, so it is taken off one side and counted once – but Hackatime could not be read to
							check which time that was, so the overlap is still in the total. It resolves itself once Hackatime answers
							again.
						</span>
					</p>
				</Panel>
			)}

			{/* ---------- the warm-up's work, and its one hand-in ---------- */}
			{warmup && <WarmupWork projectId={project.id} />}

			{/* ---------- where review stands ---------- */}
			{data.phases.length > 0 && (
				<Section id="review-title" title="Review">
					<ReviewState phases={data.phases} projectId={project.id} warmup={warmup} weekFor={weekFor} />
				</Section>
			)}

			{/* ---------- what the repo has ---------- */}
			<div className="mt-6">
				<RepoChecks editable={false} onResult={noop} project={project} />
			</div>

			{/* ---------- keeping the repo in step ---------- */}
			<Section id="repo-sync-title" title="Sync your repo">
				<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
					<RepoSyncSettings projectId={project.id} />
				</Panel>
			</Section>

			<HackatimeLinks phase={week.phase} projectId={project.id} />

			{/* ---------- the parts ---------- */}
			<Section id="bom-title" title="Bill of materials">
				<Panel className="bg-paper px-5 py-5 sm:px-6" radius={20} tone="line">
					<BomEditor
						grantUsd={grantUsd}
						items={data.bom}
						locked={data.bomLocked}
						projectId={project.id}
						taxShippingUsd={data.bomTaxShippingUsd}
						tier={project.tier}
					/>
				</Panel>
			</Section>

			{/* ---------- what happened, newest first ---------- */}
			<Section id="timeline-title" title="Timeline">
				<Panel className="bg-paper px-5 py-6 sm:px-6" radius={20} tone="line">
					{data.timeline.length === 0 ? (
						<p className="hand py-8 text-center text-[0.9rem] text-navy-soft">
							nothing on the record yet. Journal entries, timelapses and reels land here as you log them.
						</p>
					) : (
						<Timeline items={data.timeline} weekFor={weekFor} />
					)}
				</Panel>
			</Section>

			{/* ---------- last, and out of the way ---------- */}
			<Section id="delete-title" title="Delete project">
				<DeleteProject blocked={data.deleteBlocked} name={project.name} projectId={project.id} />
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
