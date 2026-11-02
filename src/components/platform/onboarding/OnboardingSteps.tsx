"use client"

import Image from "next/image"
import type { Dispatch, ReactNode, SetStateAction } from "react"
import { Gato, WeekPainting } from "@/components/platform/art"
import { IconCheck } from "@/components/platform/icons"
import { RepoSyncSettings } from "@/components/platform/RepoSyncSettings"
import { ProjectChoiceCard, StarterProjectCard } from "@/components/platform/StarterProjectCard"
import { Button, Chip, Field, OptionRow, Panel } from "@/components/platform/ui"
import { STARTER_MODIFICATION_NOTE } from "@/lib/config/onboarding"
import { cx } from "@/lib/cx"
import type { HardwareExperience } from "@/lib/enums"
import type { OnboardingView } from "@/lib/onboarding-view"
import { EXAMPLE_JOURNAL_URL } from "@/lib/routes"

const projectInputClass =
	"block w-full rounded-xl border-2 border-field bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-navy-soft focus:border-violet focus:bg-white"

/**
 * The state and transitions the steps share. Built once by `OnboardingFlow` so a step only reads what it needs, and so the server's next view is the only thing that moves the flow on.
 */
export interface OnboardingFlowContext {
	back?(): void
	busy: boolean
	chooseStart(starterProjectId: string | null): Promise<void>
	description: string
	experience: HardwareExperience | null
	idea: string | null
	pickedTier: number | null
	send(body: unknown, opts?: { advance?: boolean }): Promise<OnboardingView | null>
	sendProject(): Promise<void>
	setDescription: Dispatch<SetStateAction<string>>
	setExperience: Dispatch<SetStateAction<HardwareExperience | null>>
	setIdea: Dispatch<SetStateAction<string | null>>
	setPickedTier: Dispatch<SetStateAction<number | null>>
	setStart: Dispatch<SetStateAction<string | null | undefined>>
	setTitle: Dispatch<SetStateAction<string>>
	start: string | null | undefined
	title: string
	view: OnboardingView
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
	onBack?(): void
	onSubmit?(): void
	label?: string
	canSubmit?: boolean
	busy: boolean
}) {
	return (
		<div className="flex items-center justify-between gap-3 border-t border-dashed border-line/80 pt-5">
			{onBack ? (
				<Button disabled={busy} onClick={onBack} type="button" variant="outline">
					Back
				</Button>
			) : (
				<span />
			)}
			<Button disabled={busy || !canSubmit} onClick={onSubmit} type={onSubmit ? "button" : "submit"} variant="gold">
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
	onClick(): void
	label: string
}) {
	return (
		<Button
			aria-pressed={selected}
			disabled={disabled}
			onClick={onClick}
			type="button"
			variant={selected ? "teal" : "outline"}
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

export function ExperienceStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, experience, send, setExperience, view } = flow
	return (
		<div className="space-y-6">
			<div className="space-y-3">
				{view.experienceOptions.map(option => (
					<OptionRow
						disabled={busy}
						hint={option.hint}
						key={option.value}
						onClick={() => setExperience(option.value)}
						selected={experience === option.value}
						tone="gold"
					>
						<span className="text-[0.95rem] font-extrabold text-navy">{option.label}</span>
					</OptionRow>
				))}
			</div>
			<StepActions
				busy={busy}
				canSubmit={experience !== null}
				onBack={back}
				onSubmit={() => send({ experience, step: "experience" })}
			/>
		</div>
	)
}

export function WeekStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, chooseStart, send, setStart, start, view } = flow
	if (!view.weekIntro) return null
	return (
		<div className="space-y-6">
			{/* What the week is: its painting, then the words. */}
			<div className="flex items-start gap-4 sm:gap-6">
				<WeekPainting
					alt=""
					className="sticker-shadow size-21 shrink-0 sm:size-30"
					sizes="(min-width: 640px) 120px, 84px"
					theme={view.weekIntro.painting}
				/>
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
										action={
											<SelectButton
												disabled={busy}
												label={`Build ${starter.title}`}
												onClick={() => setStart(starter.id)}
												selected={chosen}
											/>
										}
										chosen={chosen}
										key={starter.id}
										stacked
										starter={starter}
									/>
								)
							})}
							<ProjectChoiceCard
								action={
									<SelectButton
										disabled={busy}
										label="Make a custom project"
										onClick={() => setStart(null)}
										selected={start === null}
									/>
								}
								art={<Gato className="h-35 w-auto" pose="schematic" sizes="260px" />}
								chosen={start === null}
								label="Custom project"
								stacked
								tileClassName="bg-violet-pale"
								title="Your own idea"
							>
								<p className="mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft">
									Make your own project! It can be anything you want within this week&rsquo;s theme:{" "}
									{view.weekIntro.kicker}.
								</p>
							</ProjectChoiceCard>
						</div>
						{/* Only once a starter is the pick: it is a rule about the choice, not about the step, and beside "make your own" it read as a warning about the whole fork. */}
						{typeof start === "string" ? <Note>{STARTER_MODIFICATION_NOTE}</Note> : null}
					</div>
					<StepActions
						busy={busy}
						canSubmit={start !== undefined}
						onBack={back}
						onSubmit={() => {
							if (start !== undefined) void chooseStart(start)
						}}
					/>
				</>
			) : (
				<StepActions busy={busy} onBack={back} onSubmit={() => send({ step: "week" })} />
			)}
		</div>
	)
}

export function ProjectStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, description, sendProject, setDescription, setTitle, title } = flow
	return (
		<form
			className="space-y-5"
			onSubmit={event => {
				event.preventDefault()
				void sendProject()
			}}
		>
			<p className="text-[0.9rem] leading-relaxed text-navy-soft">
				Tell us about your project! You can always edit this later.
			</p>
			<Field hint="Give it a cool name!" id="onboarding-project-name" label="Project name">
				<input
					className={projectInputClass}
					id="onboarding-project-name"
					maxLength={120}
					onChange={event => setTitle(event.target.value)}
					value={title}
				/>
			</Field>
			<Field id="onboarding-project-description" label="Project description">
				<textarea
					className={`${projectInputClass} min-h-28 resize-y`}
					id="onboarding-project-description"
					maxLength={5000}
					onChange={event => setDescription(event.target.value)}
					value={description}
				/>
			</Field>
			<StepActions busy={busy} onBack={back} />
		</form>
	)
}

export function IdeaStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, idea, send, setIdea, view } = flow
	return (
		<div className="space-y-5">
			<p className="text-[0.9rem] leading-relaxed text-navy-soft">
				Starter projects come with a guide that walks you through every step. Taking one sets your project to Tier 1,
				since starters are Tier 1 work. Stick with your own idea if you want a bigger tier.
			</p>
			<div className="grid gap-3">
				{view.starterProjects.map(starter => {
					const chosen = idea === starter.id
					return (
						<StarterProjectCard
							action={
								<SelectButton
									disabled={busy}
									label={`Build ${starter.title}`}
									onClick={() => setIdea(chosen ? null : starter.id)}
									selected={chosen}
								/>
							}
							chosen={chosen}
							key={starter.id}
							starter={starter}
						/>
					)
				})}
			</div>
			{/* Only once a starter is the pick, for the same reason as the week step: the rule is about taking a starter, not about this step. */}
			{idea !== null ? <Note>{STARTER_MODIFICATION_NOTE}</Note> : null}
			<StepActions
				busy={busy}
				label={idea ? "Next" : "Stick with my own idea"}
				onBack={back}
				onSubmit={() => send({ starterProjectId: idea, step: "idea" })}
			/>
		</div>
	)
}

export function TierStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, pickedTier, send, setPickedTier, view } = flow
	return (
		<div className="space-y-5">
			<p className="text-[0.9rem] leading-relaxed text-navy-soft">
				Choose what tier fits your project! You can change this at any time until you submit your design, and your
				reviewer confirms it when they approve.
			</p>
			{view.project.tierLocked ? (
				<Note>
					You picked a starter project, so you&rsquo;re fixed to Tier 1. You can go back and make a custom project if
					you&rsquo;d like.
				</Note>
			) : null}
			{/* Each tier is one choice: the grant, the rough time, and real projects built at it. The examples link to their repos, so the card cannot be a button; a click anywhere on it picks the tier for the mouse, and the radio in its header is the control for keyboards and screen readers. */}
			<fieldset className="grid gap-3">
				<legend className="sr-only">Tier</legend>
				{view.tiers.map(tier => {
					const chosen = view.project.tierLocked ? tier.id === 1 : pickedTier === tier.id
					const locked = busy || view.project.tierLocked
					const headingId = `onboarding-tier-${tier.id}`
					return (
						<label
							className={cx(
								"block rounded-2xl has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
								locked ? "cursor-default" : "group cursor-pointer",
							)}
							key={tier.id}
						>
							<Panel
								className={cx(
									"px-4 py-3.5 transition-colors sm:px-5 sm:py-4",
									chosen ? "bg-gold-pale/40" : "bg-white group-hover:bg-black/[.015]",
								)}
								radius={16}
								tone={chosen ? "gold" : "line"}
							>
								<div className="flex items-center justify-between gap-3">
									<input
										aria-labelledby={headingId}
										checked={chosen}
										className="sr-only"
										disabled={locked}
										name="onboarding-tier"
										onChange={() => setPickedTier(tier.id)}
										type="radio"
									/>
									<h3 className="text-[1.2rem] leading-tight font-extrabold text-navy" id={headingId}>
										{tier.name}: ${tier.grantUsd}{" "}
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
											<li className="min-w-0" key={project.href}>
												<a
													className="group/example -m-1 flex items-center gap-2.5 rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-violet"
													href={project.href}
													// Following the link is not a vote for the tier.
													onClick={event => event.stopPropagation()}
													rel="noopener noreferrer"
													target="_blank"
												>
													{/* Cropped to one frame: at this size a uniform row reads better than slivers and posts, and the repo has the whole board. */}
													<span className="relative block h-11 w-14 shrink-0 overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgb(28_26_89/0.12)] ring-1 ring-line/70">
														<Image
															alt=""
															className="object-cover transition-transform duration-300 ease-out group-hover/example:scale-[1.08]"
															fill
															sizes="112px"
															src={project.image}
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
				canSubmit={view.project.tierLocked || pickedTier !== null}
				onBack={back}
				onSubmit={() => send({ requestedTier: view.project.tierLocked ? null : pickedTier, step: "tier" })}
			/>
		</div>
	)
}

export function TrackingStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, send } = flow
	return (
		<div className="space-y-5">
			<p className="text-[0.92rem] leading-relaxed text-navy-soft">
				Tracking progress of your project is mandatory, and you log it in two ways. A{" "}
				<strong className="text-navy">journal</strong> entry is a detailed writeup of what you did in a session (
				<a
					className="font-semibold text-sky-ink underline decoration-dashed underline-offset-4 hover:text-navy"
					href={EXAMPLE_JOURNAL_URL}
					rel="noopener noreferrer"
					target="_blank"
				>
					here&rsquo;s an example
				</a>
				). A <strong className="text-navy">timelapse</strong> is a screenrecording or video of yourself working on your
				project. Every approved hour you log past the funding for your chosen tier earns{" "}
				<strong className="rounded bg-gold-pale px-1 text-gold-ink">5 coins</strong>. Those funded hours pay for your
				parts instead. Coins are what you spend in the shop.
			</p>
			<ul className="grid gap-3 sm:grid-cols-3">
				{[
					["Timelapses", "Use Lapse to record the work, then attach the recording to your project."],
					["Journal", "Write what you did, what broke, and what is next after each session."],
					["Keep it daily", "Logging on the day is worth doing: your streak counts days you journalled."],
				].map(([heading, body]) => (
					<Panel as="li" className="bg-white p-4" key={heading} radius={16} tone="line">
						<h3 className="text-[0.92rem] font-extrabold text-navy">{heading}</h3>
						<p className="mt-2 text-[0.8rem] leading-relaxed text-navy-soft">{body}</p>
					</Panel>
				))}
			</ul>
			<p className="text-[0.9rem] leading-relaxed text-navy-soft">
				Time spent researching may be deflated fully or partially unless it&apos;s clearly used productively (for
				example, taking notes from tutorials or referencing datasheets).
			</p>
			<StepActions
				busy={busy}
				label="Next"
				onBack={back}
				onSubmit={() => send({ dismissed: true, step: "tracking" })}
			/>
		</div>
	)
}

export function RepoStep({ flow }: { flow: OnboardingFlowContext }) {
	const { busy, back, send, view } = flow
	return (
		<div className="space-y-5">
			<p className="text-[0.92rem] leading-relaxed text-navy-soft">
				Want your devlogs and parts list in your project&rsquo;s repo? Turn the sync on and Half Life keeps{" "}
				<code className="hand text-navy">JOURNAL.md</code> and <code className="hand text-navy">BOM.csv</code> up to
				date in it as you work. You can turn it on later from the project page, so this is optional.
			</p>
			<RepoSyncSettings compact onEnabled={() => send({ enabled: true, step: "repo" })} projectId={view.projectId} />
			<StepActions busy={busy} label="Finish" onBack={back} onSubmit={() => send({ enabled: false, step: "repo" })} />
		</div>
	)
}
