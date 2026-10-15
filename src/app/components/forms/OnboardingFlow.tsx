"use client"

import Image from "next/image"
import { type ReactNode, useState } from "react"
import { Gato, WeekPainting } from "@/components/platform/art"
import { IconCheck } from "@/components/platform/icons"
import { RepoSyncSettings } from "@/components/platform/RepoSyncSettings"
import { ProjectChoiceCard, StarterProjectCard } from "@/components/platform/StarterProjectCard"
import { Button, Chip, Field, OptionRow, Panel } from "@/components/platform/ui"
import { STARTER_MODIFICATION_NOTE } from "@/lib/config/onboarding"
import { cx } from "@/lib/cx"
import type { OnboardingView } from "@/lib/onboarding-view"
import { EXAMPLE_JOURNAL_URL } from "@/lib/routes"

const projectInputClass =
	"block w-full rounded-xl border-2 border-field bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-navy-soft focus:border-violet focus:bg-white"

type OnboardingResponse = {
	onboarding?: OnboardingView
	error?: { message?: string }
}

/**
 * Every step ends on the same bar: Back on the left, the step's one submit on the right. Choosing an option only selects it; nothing is sent until this. Without `onSubmit` the button submits its enclosing form.
 */
function StepActions({
	onBack,
	onSubmit,
	label = "Next",
	canSubmit = true,
	busy,
}: {
	onBack?: () => void
	onSubmit?: () => void
	label?: string
	canSubmit?: boolean
	busy: boolean
}) {
	return (
		<div className="flex items-center justify-between gap-3 border-t border-dashed border-line/80 pt-5">
			{onBack ? (
				<Button type="button" variant="outline" onClick={onBack} disabled={busy}>
					Back
				</Button>
			) : (
				<span />
			)}
			<Button type={onSubmit ? "button" : "submit"} variant="gold" onClick={onSubmit} disabled={busy || !canSubmit}>
				{busy ? "Saving…" : label}
			</Button>
		</div>
	)
}

/** Picks a card that holds links, so the card itself cannot be the control. */
function SelectButton({
	selected,
	disabled,
	onClick,
	label,
}: {
	selected: boolean
	disabled: boolean
	onClick: () => void
	label: string
}) {
	return (
		<Button
			type="button"
			variant={selected ? "teal" : "outline"}
			aria-pressed={selected}
			disabled={disabled}
			onClick={onClick}
		>
			{label}
			{selected ? <IconCheck className="text-base" /> : null}
		</Button>
	)
}

function Note({ children }: { children: ReactNode }) {
	return (
		<div className="rounded-2xl border-2 border-dashed border-gold-deep/40 bg-gold-pale/50 px-4 py-3 text-[0.86rem] leading-relaxed text-navy-soft">
			{children}
		</div>
	)
}

/**
 * The one onboarding interaction. It is rendered by the dashboard's Get started modal; the server owns the state machine and every response returns the next canonical view.
 */
export function OnboardingFlow({
	initial,
	onComplete,
}: Readonly<{ initial: OnboardingView; onComplete?: () => void }>) {
	const [view, setView] = useState(initial)
	const [viewing, setViewing] = useState(Math.min(initial.reached, initial.steps.length - 1))
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [title, setTitle] = useState(initial.project.title)
	const [description, setDescription] = useState(initial.project.description)
	// What each choice step has selected but not yet submitted, seeded from what the server already has so coming back to a step shows the earlier answer.
	const [experience, setExperience] = useState(initial.experience)
	// The beginner's fork: a starter id, null for their own project, undefined for not chosen yet. Past the week step with no starter means they chose their own.
	const [start, setStart] = useState<string | null | undefined>(() => {
		if (initial.project.starterProjectId) return initial.project.starterProjectId
		return initial.reached > initial.steps.findIndex(s => s.id === "week") ? null : undefined
	})
	const [idea, setIdea] = useState<string | null>(initial.project.starterProjectId)
	const [pickedTier, setPickedTier] = useState<number | null>(initial.project.requestedTier)

	const step = view.steps[viewing]
	if (!step) return null

	// The server decides where an answer lands (a starter taken on the week step goes straight to time tracking; naming a project skips "Stuck? Pick one", since the starter was offered on the week step), and this mirrors it, both forward and back.
	const indexOf = (id: string) => view.steps.findIndex(s => s.id === id)
	const tookStarter = view.project.starterProjectId !== null && view.project.tierLocked
	function backFrom(current: number): number {
		const id = view.steps[current]?.id
		if (id === "tracking" && tookStarter) return indexOf("week")
		if (id === "tier") return indexOf("project")
		return Math.max(0, current - 1)
	}

	async function send(body: unknown, opts: { advance?: boolean } = {}): Promise<OnboardingView | null> {
		setBusy(true)
		setError(null)
		try {
			const res = await fetch("/api/onboarding", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			})
			const payload = (await res.json().catch(() => null)) as OnboardingResponse | null
			if (!res.ok || !payload?.onboarding) {
				setError(payload?.error?.message ?? `Something went wrong (${res.status})`)
				return null
			}

			const next = payload.onboarding
			setView(next)
			if (next.completed) {
				onComplete?.()
				return next
			}

			if (opts.advance !== false) setViewing(current => Math.min(current + 1, next.steps.length - 1))
			return next
		} catch (err) {
			setError(err instanceof Error ? err.message : "Something went wrong")
			return null
		} finally {
			setBusy(false)
		}
	}

	async function sendProject() {
		const next = await send({ step: "project", title, description }, { advance: false })
		if (next && !next.completed) setViewing(indexOf("tier"))
	}

	/** The beginner's fork on the week step: a starter, or their own project. */
	async function chooseStart(starterProjectId: string | null) {
		const next = await send({ step: "week", starterProjectId }, { advance: false })
		if (next && !next.completed) setViewing(indexOf(starterProjectId ? "tracking" : "project"))
	}

	const back = viewing > 0 ? () => setViewing(backFrom) : undefined

	// No panel of its own: it is the whole body of the Getting started modal, whose frame and eyebrow already say what this is. A second bordered card inside it only boxed the same content twice.
	return (
		<div>
			<div className="mb-6">
				<div>
					<p className="label text-gold-ink">
						Step {step.number}/{view.stepCount}
					</p>
					{step.id === "week" && view.weekIntro ? (
						// The week step is a reveal: its heading trails off ("this week it's...") so it leads in, and the theme it leads to is the title.
						<>
							<p className="hand mt-1.5 text-[0.95rem] text-navy-soft">{step.heading}</p>
							<h2 className="mt-0.5 text-[1.7rem] leading-tight font-extrabold tracking-[-0.025em] text-navy sm:text-[2.1rem]">
								{view.weekIntro.kicker}
							</h2>
						</>
					) : (
						<h2 className="mt-1 text-[1.5rem] leading-tight font-extrabold tracking-[-0.02em] text-navy sm:text-[1.85rem]">
							{step.heading}
						</h2>
					)}
				</div>
			</div>

			{error ? (
				<p role="alert" className="mb-5 rounded-xl bg-coral/10 px-4 py-3 text-[0.86rem] font-semibold text-coral-dark">
					{error}
				</p>
			) : null}

			<div className="space-y-5">
				{step.id === "experience" ? (
					<div className="space-y-6">
						<div className="space-y-3">
							{view.experienceOptions.map(option => (
								<OptionRow
									key={option.value}
									tone="gold"
									selected={experience === option.value}
									disabled={busy}
									hint={option.hint}
									onClick={() => setExperience(option.value)}
								>
									<span className="text-[0.95rem] font-extrabold text-navy">{option.label}</span>
								</OptionRow>
							))}
						</div>
						<StepActions
							busy={busy}
							onBack={back}
							canSubmit={experience !== null}
							onSubmit={() => send({ step: "experience", experience })}
						/>
					</div>
				) : null}

				{step.id === "week" && view.weekIntro ? (
					<div className="space-y-6">
						{/* What the week is: its painting, then the words. */}
						<div className="flex items-start gap-4 sm:gap-6">
							<WeekPainting
								theme={view.weekIntro.painting}
								alt=""
								sizes="(min-width: 640px) 120px, 84px"
								className="sticker-shadow size-[84px] shrink-0 sm:size-[120px]"
							/>
							<div className="min-w-0 flex-1 space-y-2">
								{view.beginner ? (
									<p className="max-w-[62ch] text-[0.92rem] leading-relaxed text-navy-soft">{view.weekIntro.primer}</p>
								) : (
									<>
										<p className="text-[0.92rem] text-navy-soft">Some places to start, if you want one:</p>
										<ul className="list-disc space-y-1 pl-5 text-[0.9rem] text-navy-soft">
											{view.weekIntro.examples.map(example => (
												<li key={example}>{example}</li>
											))}
										</ul>
									</>
								)}
							</div>
						</div>

						{view.beginner && view.starterProjects.length > 0 ? (
							// The fork. Two ways in, side by side and the same shape, each with its own select button (the cards hold links, so the whole card cannot be one), then the step's Next.
							<>
								<div className="space-y-3 border-t border-dashed border-line/80 pt-5">
									<p className="text-[0.92rem] leading-relaxed text-navy-soft">
										<strong className="font-extrabold text-navy">New to this?</strong> Build this week&rsquo;s starter
										project, with a guide that walks you through every step. Or make a project of your own.
									</p>
									<div className="grid gap-3 sm:grid-cols-2">
										{view.starterProjects.map(starter => {
											const chosen = start === starter.id
											return (
												<StarterProjectCard
													key={starter.id}
													starter={starter}
													chosen={chosen}
													stacked
													action={
														<SelectButton
															selected={chosen}
															disabled={busy}
															onClick={() => setStart(starter.id)}
															label={`Build ${starter.title}`}
														/>
													}
												/>
											)
										})}
										<ProjectChoiceCard
											stacked
											chosen={start === null}
											tileClassName="bg-violet-pale"
											art={<Gato pose="schematic" sizes="260px" className="h-[140px] w-auto" />}
											label="Custom project"
											title="Your own idea"
											action={
												<SelectButton
													selected={start === null}
													disabled={busy}
													onClick={() => setStart(null)}
													label="Make a custom project"
												/>
											}
										>
											<p className="mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft">
												Make your own project! It can be anything you want.
											</p>
										</ProjectChoiceCard>
									</div>
									{/* Only once a starter is the pick: it is a rule about the choice, not about the step, and beside "make your own" it read as a warning about the whole fork. */}
									{typeof start === "string" ? <Note>{STARTER_MODIFICATION_NOTE}</Note> : null}
								</div>
								<StepActions
									busy={busy}
									onBack={back}
									canSubmit={start !== undefined}
									onSubmit={() => {
										if (start !== undefined) chooseStart(start)
									}}
								/>
							</>
						) : (
							<StepActions busy={busy} onBack={back} onSubmit={() => send({ step: "week" })} />
						)}
					</div>
				) : null}

				{step.id === "project" ? (
					<form
						className="space-y-5"
						onSubmit={event => {
							event.preventDefault()
							sendProject()
						}}
					>
						<p className="text-[0.9rem] leading-relaxed text-navy-soft">
							Tell us about your project! You can always edit this later.
						</p>
						<Field id="onboarding-project-name" label="Project name" hint="Give it a cool name!">
							<input
								id="onboarding-project-name"
								className={projectInputClass}
								value={title}
								maxLength={120}
								onChange={event => setTitle(event.target.value)}
							/>
						</Field>
						<Field id="onboarding-project-description" label="Project description">
							<textarea
								id="onboarding-project-description"
								className={`${projectInputClass} min-h-28 resize-y`}
								value={description}
								maxLength={5000}
								onChange={event => setDescription(event.target.value)}
							/>
						</Field>
						<StepActions busy={busy} onBack={back} />
					</form>
				) : null}

				{step.id === "idea" ? (
					<div className="space-y-5">
						<p className="text-[0.9rem] leading-relaxed text-navy-soft">
							Starter projects come with a guide that walks you through every step. Taking one sets your project to Tier
							1, since starters are Tier 1 work. Stick with your own idea if you want a bigger tier.
						</p>
						<div className="grid gap-3">
							{view.starterProjects.map(starter => {
								const chosen = idea === starter.id
								return (
									<StarterProjectCard
										key={starter.id}
										starter={starter}
										chosen={chosen}
										action={
											<SelectButton
												selected={chosen}
												disabled={busy}
												onClick={() => setIdea(chosen ? null : starter.id)}
												label={`Build ${starter.title}`}
											/>
										}
									/>
								)
							})}
						</div>
						{/* Only once a starter is the pick, for the same reason as the week step: the rule is about taking a starter, not about this step. */}
						{idea !== null ? <Note>{STARTER_MODIFICATION_NOTE}</Note> : null}
						<StepActions
							busy={busy}
							onBack={back}
							label={idea ? "Next" : "Stick with my own idea"}
							onSubmit={() => send({ step: "idea", starterProjectId: idea })}
						/>
					</div>
				) : null}

				{step.id === "tier" ? (
					<div className="space-y-5">
						<p className="text-[0.9rem] leading-relaxed text-navy-soft">
							Choose what tier fits your project! You can change this at any time until you submit your design, and your
							reviewer confirms it when they approve.
						</p>
						{view.project.tierLocked ? (
							<Note>
								You picked a starter project, so you&rsquo;re fixed to Tier 1. You can go back and make a custom project
								if you&rsquo;d like.
							</Note>
						) : null}
						{/* Each tier is one choice: the grant, the rough time, and real
                projects built at it. The examples link to their repos, so the
                card cannot be a button; a click anywhere on it picks the tier
                for the mouse, and the radio in its header is the control for
                keyboards and screen readers. */}
						<fieldset className="grid gap-3">
							<legend className="sr-only">Tier</legend>
							{view.tiers.map(tier => {
								const chosen = view.project.tierLocked ? tier.id === 1 : pickedTier === tier.id
								const locked = busy || view.project.tierLocked
								const headingId = `onboarding-tier-${tier.id}`
								return (
									<label
										key={tier.id}
										className={cx(
											"block rounded-2xl has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
											locked ? "cursor-default" : "group cursor-pointer",
										)}
									>
										<Panel
											tone={chosen ? "gold" : "line"}
											radius={16}
											className={cx(
												"px-4 py-3.5 transition-colors sm:px-5 sm:py-4",
												chosen ? "bg-gold-pale/40" : "bg-white group-hover:bg-black/[.015]",
											)}
										>
											<div className="flex items-center justify-between gap-3">
												<input
													type="radio"
													name="onboarding-tier"
													className="sr-only"
													checked={chosen}
													disabled={locked}
													aria-labelledby={headingId}
													onChange={() => setPickedTier(tier.id)}
												/>
												<h3 id={headingId} className="text-[1.2rem] leading-tight font-extrabold text-navy">
													{tier.name} – ${tier.grantUsd}{" "}
													<span className="font-semibold text-navy-soft">({tier.estimate})</span>
												</h3>
												{chosen ? (
													<Chip tone="teal">
														<IconCheck className="text-sm" /> Selected
													</Chip>
												) : tier.id === view.suggestedTier ? (
													<Chip tone="gold">Suggested</Chip>
												) : null}
											</div>
											{tier.showcase.length > 0 ? (
												// The tier line leads; the examples are its footnote, a strip of small thumbnails with their names beside them. Three columns on every tier, so the strips align down the list whatever their length, and fold to a stacked list on a phone.
												<ul className="mt-3 grid gap-x-4 gap-y-2 border-t border-dashed border-line/80 pt-3 sm:grid-cols-3">
													{tier.showcase.map(project => (
														<li key={project.href} className="min-w-0">
															<a
																href={project.href}
																target="_blank"
																rel="noopener noreferrer"
																// Following the link is not a vote for the tier.
																onClick={event => event.stopPropagation()}
																className="group/example -m-1 flex items-center gap-2.5 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-violet"
															>
																{/* Cropped to one frame: at this size a uniform
                                    row reads better than slivers and posts, and
                                    the repo has the whole board. */}
																<span className="relative block h-11 w-14 shrink-0 overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgb(28_26_89/0.12)] ring-1 ring-line/70">
																	<Image
																		src={project.image}
																		alt=""
																		fill
																		sizes="112px"
																		className="object-cover transition-transform duration-300 ease-out group-hover/example:scale-[1.08]"
																	/>
																</span>
																<span className="min-w-0 text-[0.8rem] leading-snug text-navy-soft decoration-dashed underline-offset-[3px] group-hover/example:text-navy group-hover/example:underline">
																	{project.title}
																	<span className="sr-only"> (opens the project on GitHub)</span>
																</span>
															</a>
														</li>
													))}
												</ul>
											) : null}
										</Panel>
									</label>
								)
							})}
						</fieldset>
						{/* A starter's tier is already set, so its Next carries no tier. */}
						<StepActions
							busy={busy}
							onBack={back}
							canSubmit={view.project.tierLocked || pickedTier !== null}
							onSubmit={() => send({ step: "tier", requestedTier: view.project.tierLocked ? null : pickedTier })}
						/>
					</div>
				) : null}

				{step.id === "tracking" ? (
					<div className="space-y-5">
						<p className="text-[0.92rem] leading-relaxed text-navy-soft">
							Tracking progress of your project is mandatory, and you log it in two ways. A{" "}
							<strong className="text-navy">journal</strong> entry is a detailed writeup of what you did in a session (
							<a
								href={EXAMPLE_JOURNAL_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="font-semibold text-sky-ink underline decoration-dashed underline-offset-4 hover:text-navy"
							>
								here&rsquo;s an example
							</a>
							). A <strong className="text-navy">timelapse</strong> is a screenrecording or video of yourself working on
							your project. Every approved hour you log past the funding for your chosen tier earns{" "}
							<strong className="rounded bg-gold-pale px-1 text-gold-ink">5 coins</strong> – those funded hours pay for
							your parts instead. Coins are what you spend in the shop.
						</p>
						<ul className="grid gap-3 sm:grid-cols-3">
							{[
								["Timelapses", "Use Lapse to record the work, then attach the recording to your project."],
								["Journal", "Write what you did, what broke, and what is next after each session."],
								["Keep it daily", "Logging on the day is worth doing: your streak counts days you journalled."],
							].map(([heading, body]) => (
								<Panel key={heading} as="li" tone="line" radius={16} className="bg-white p-4">
									<h3 className="text-[0.92rem] font-extrabold text-navy">{heading}</h3>
									<p className="mt-2 text-[0.8rem] leading-relaxed text-navy-soft">{body}</p>
								</Panel>
							))}
						</ul>
						<p className="text-[0.9rem] leading-relaxed text-navy-soft">
							Time spent researching may be deflated fully or partially unless it&apos;s clearly used productively – for
							example, taking notes from tutorials or referencing datasheets.
						</p>
						<StepActions
							busy={busy}
							onBack={back}
							label="Next"
							onSubmit={() => send({ step: "tracking", dismissed: true })}
						/>
					</div>
				) : null}

				{step.id === "repo" ? (
					<div className="space-y-5">
						<p className="text-[0.92rem] leading-relaxed text-navy-soft">
							Want your devlogs and parts list in your project&rsquo;s repo? Turn the sync on and Half Life keeps{" "}
							<code className="hand text-navy">JOURNAL.md</code> and <code className="hand text-navy">BOM.csv</code> up
							to date in it as you work. You can turn it on later from the project page, so this is optional.
						</p>
						<RepoSyncSettings
							projectId={view.projectId}
							compact
							onEnabled={() => send({ step: "repo", enabled: true })}
						/>
						<StepActions
							busy={busy}
							onBack={back}
							label="Finish"
							onSubmit={() => send({ step: "repo", enabled: false })}
						/>
					</div>
				) : null}
			</div>
		</div>
	)
}
