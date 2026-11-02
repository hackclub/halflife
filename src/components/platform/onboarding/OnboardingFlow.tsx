"use client"

import { useState } from "react"
import { OnboardingResponseSchema, type OnboardingView } from "@/lib/onboarding-view"
import {
	ExperienceStep,
	IdeaStep,
	type OnboardingFlowContext,
	ProjectStep,
	RepoStep,
	TierStep,
	TrackingStep,
	WeekStep,
} from "./OnboardingSteps"

/**
 * The one onboarding interaction. It is rendered by the dashboard's Get started modal; the server owns the state machine and every response returns the next canonical view.
 */
export function OnboardingFlow({ initial, onComplete }: Readonly<{ initial: OnboardingView; onComplete?(): void }>) {
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
				body: JSON.stringify(body),
				headers: { "Content-Type": "application/json" },
				method: "POST",
			})
			const parsed = OnboardingResponseSchema.safeParse(await res.json().catch(() => null))
			if (!res.ok || !parsed.success || !parsed.data.onboarding) {
				setError((parsed.success ? parsed.data.error?.message : undefined) ?? `Something went wrong (${res.status})`)
				return null
			}

			const next = parsed.data.onboarding
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
		const next = await send({ description, step: "project", title }, { advance: false })
		if (next && !next.completed) setViewing(indexOf("tier"))
	}

	/** The beginner's fork on the week step: a starter, or their own project. */
	async function chooseStart(starterProjectId: string | null) {
		const next = await send({ starterProjectId, step: "week" }, { advance: false })
		if (next && !next.completed) setViewing(indexOf(starterProjectId ? "tracking" : "project"))
	}

	const back = viewing > 0 ? () => setViewing(backFrom) : undefined
	const flow: OnboardingFlowContext = {
		back,
		busy,
		chooseStart,
		description,
		experience,
		idea,
		pickedTier,
		send,
		sendProject,
		setDescription,
		setExperience,
		setIdea,
		setPickedTier,
		setStart,
		setTitle,
		start,
		title,
		view,
	}

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
				<p className="mb-5 rounded-xl bg-coral/10 px-4 py-3 text-[0.86rem] font-semibold text-coral-dark" role="alert">
					{error}
				</p>
			) : null}

			<div className="space-y-5">
				{step.id === "experience" ? <ExperienceStep flow={flow} /> : null}
				{step.id === "week" && view.weekIntro ? <WeekStep flow={flow} /> : null}
				{step.id === "project" ? <ProjectStep flow={flow} /> : null}
				{step.id === "idea" ? <IdeaStep flow={flow} /> : null}
				{step.id === "tier" ? <TierStep flow={flow} /> : null}
				{step.id === "tracking" ? <TrackingStep flow={flow} /> : null}
				{step.id === "repo" ? <RepoStep flow={flow} /> : null}
			</div>
		</div>
	)
}
