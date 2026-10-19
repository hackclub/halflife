import "server-only"
import { type HardwareExperience, PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import {
	ONBOARDING_STEP_COUNT,
	type OnboardingStep,
	STARTER_PROJECT_TIER,
	type StarterProject,
	seesStarterProjects,
	starterProjectsFor,
	stepAt,
	stepIndexOf,
	suggestedTierFor,
} from "@/lib/config/onboarding"
import { DESIGN_WEEKS, THEMES } from "@/lib/config/program"
import { isTierId, type TierId } from "@/lib/config/tiers"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"
import { getProgramSettings, weekNumberForDate } from "@/lib/program"
import { ensureThemeProject } from "@/lib/provisioning"
import { sanitize, sanitizeHtml } from "@/lib/sanitize"

/**
 * The first checkpoint's state machine.
 *
 * Two rules hold everything together:
 *
 * 1. `onboardingStep` is the furthest step REACHED, never the step being displayed. Answering step 3 again after reaching step 5 edits the answer and leaves the progress alone, so a participant can go back and change their project name without being walked through the tier question again.
 * 2. Nothing here writes `ThemeProject.tier`. The participant's choice lands in `requestedTier`; the reviewer's decision at design approval is a different column, and money is paid against theirs.
 */

/** Week one's theme, and the fallback for anything that cannot resolve the participant's join week. The comp: "This is PCB week!" */
export const ONBOARDING_THEME: Theme = Theme.PCB

export interface OnboardingState {
	completed: boolean
	/** The step to show now. */
	current: OnboardingStep | null
	experience: HardwareExperience | null
	project: {
		id: string
		title: string
		description: string | null
		requestedTier: number | null
		starterProjectId: string | null
		/** Starter projects are Tier 1 work, so the choice is not the user's. */
		tierLocked: boolean
	}
	/** Furthest step reached, 0-based. */
	reached: number
	starterProjects: readonly StarterProject[]
	stepCount: number
	suggestedTier: TierId
	/** The theme this person is onboarding into: the one their first project belongs to. */
	theme: Theme
	trackingDismissed: boolean
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
	// One round trip for both reads. Onboarding edits the participant's first project, which exists once they have one; the theme is that project's, not a fixed week one. A late joiner who starts in week 3 is onboarded into Music and offered the MIDI keyboard, rather than being shown week one's PCB starter.
	//
	// An existing project is the anchor: once the flow has made one, the theme cannot move under someone who finishes the questions the next day. With no project yet, the fallback is the theme of the current program week, so an onboarding started today is for the week it is actually happening in.
	const [user, found] = await Promise.all([
		prisma.user.findUniqueOrThrow({
			select: {
				hardwareExperience: true,
				onboardingCompletedAt: true,
				onboardingStep: true,
				trackingTutorialDismissedAt: true,
			},
			where: { id: userId },
		}),
		prisma.themeProject.findFirst({
			orderBy: { createdAt: "asc" },
			select: { ...PROJECT_SELECT, theme: true },
			where: { deletedAt: null, theme: { not: Theme.WARMUP }, userId },
		}),
	])

	let project: ReturnType<typeof pickProject>
	let theme: Theme
	if (found) {
		project = pickProject(found)
		theme = found.theme
	} else {
		const settings = await getProgramSettings()
		theme = themeForCurrentWeek(settings.eventStartDate, settings.programTimezone)
		project = pickProject(await ensureThemeProject(userId, theme))
	}

	const reached = clampStep(user.onboardingStep)

	return {
		completed: user.onboardingCompletedAt !== null,
		current: stepAt(reached) ?? null,
		experience: user.hardwareExperience,
		project: {
			...project,
			tierLocked: project.starterProjectId !== null,
		},
		reached,
		starterProjects: startersShownTo(user.hardwareExperience, theme),
		stepCount: ONBOARDING_STEP_COUNT,
		suggestedTier: suggestedTierFor(user.hardwareExperience),
		theme,
		trackingDismissed: user.trackingTutorialDismissedAt !== null,
	}
}

/**
 * The season theme for the program week happening now. Before week one it is PCB week; after week five it wraps to the same theme the build week belongs to.
 */
function themeForCurrentWeek(eventStartDate: Date, programTimezone: string): Theme {
	const week = weekNumberForDate(eventStartDate, new Date(), programTimezone)
	const designWeek = ((Math.max(week, 1) - 1) % DESIGN_WEEKS) + 1
	return THEMES.find(t => t.designWeek === designWeek)?.id ?? ONBOARDING_THEME
}

/** The project fields the flow reads and writes. */
const PROJECT_SELECT = {
	description: true,
	id: true,
	requestedTier: true,
	starterProjectId: true,
	title: true,
} as const

function pickProject(p: {
	id: string
	title: string
	description: string | null
	requestedTier: number | null
	starterProjectId: string | null
}) {
	return {
		description: p.description,
		id: p.id,
		requestedTier: p.requestedTier,
		starterProjectId: p.starterProjectId,
		title: p.title,
	}
}

/** The starter projects this answer to question one is offered, for the onboarding theme. */
function startersShownTo(experience: HardwareExperience | null, theme: Theme): readonly StarterProject[] {
	return seesStarterProjects(experience) ? starterProjectsFor(theme) : []
}

function clampStep(step: number): number {
	if (!Number.isFinite(step) || step < 0) return 0
	return Math.min(step, ONBOARDING_STEP_COUNT)
}

/** Answers, one shape per step. The route validates before this is reached. */
export type OnboardingAnswer =
	| { step: "experience"; experience: HardwareExperience }
	| { step: "week"; starterProjectId?: string | null }
	| { step: "project"; title: string; description: string }
	| { step: "idea"; starterProjectId: string | null }
	| { step: "tier"; requestedTier: number | null }
	| { step: "tracking"; dismissed: boolean }
	| { step: "repo"; enabled: boolean; repo?: string | null }

export interface AdvanceResult {
	completed: boolean
	/**
	 * A request to mirror the project into a repo, made on the setup flow's repo step. The route runs this after the response has gone, because it is a GitHub round trip that can fail and the flow finishing must not depend on it. Null when the step was skipped or the sync was declined.
	 */
	repoRequest: { repo: string } | null
	state: OnboardingState
	/**
	 * Whether the answer wrote the project row. The caller then runs `markProjectCreated` for the analytics stamp: in the API route after the response has gone, since nobody is waiting on it; here it cannot, because `after` only works inside a request and the verify scripts call this too.
	 */
	touchedProject: boolean
}

/**
 * Record one step's answer and move the furthest-reached marker forward.
 *
 * An answer that touches the project writes it and the progress marker in one transaction, since a half-applied answer strands someone on a step they have already completed. An answer that only touches the user is a single update: a transaction there would only add its BEGIN and COMMIT, two round trips of ~115ms each from a dev machine, and there is nothing to keep atomic.
 *
 * Where the flow goes next is decided here, not only in the browser, so the server never has someone "on" a step the page skipped:
 *
 * - A beginner forks on the week step. Building the starter answers the project, idea and tier steps at once (its name, its pick, Tier 1) and moves them straight to time tracking. Their own project goes on to naming it.
 * - The idea step ("Stuck? Pick one") is stepped over after naming a project. The starter is offered on the week step now, and anyone naming their own project has already said no to it.
 */
export async function submitStep(userId: string, answer: OnboardingAnswer): Promise<AdvanceResult> {
	const before = await getOnboardingState(userId)

	if (before.completed) throw new HttpError("ALREADY_RESOLVED", "You have already finished getting started")

	const index = stepIndexOf(answer.step)
	if (index === -1) throw new HttpError("VALIDATION_FAILED", "Unknown step")
	// Answering ahead of where you have got would let someone skip the questions by posting the last step first.
	if (index > before.reached) throw new HttpError("VALIDATION_FAILED", "Finish the earlier steps first")

	const userData: {
		hardwareExperience?: HardwareExperience
		trackingTutorialDismissedAt?: Date
	} = {}
	const projectData: {
		title?: string
		description?: string
		requestedTier?: number | null
		starterProjectId?: string | null
	} = {}

	switch (answer.step) {
		case "experience":
			userData.hardwareExperience = answer.experience
			break

		case "week": {
			// For most people the PCB week explainer, with nothing to record beyond having been through it. For a beginner it is also the fork.
			if (answer.starterProjectId === undefined) break
			if (answer.starterProjectId === null) {
				// Their own project: drop a starter taken on an earlier pass, so the tier is theirs to choose again.
				projectData.starterProjectId = null
				break
			}
			// Only one this person was actually offered: the list depends on their answer to question one, and posting an id is not an answer.
			const starter = before.starterProjects.find(p => p.id === answer.starterProjectId)
			if (!starter) throw new HttpError("VALIDATION_FAILED", "That is not one of the suggestions")
			projectData.starterProjectId = starter.id
			projectData.title = starter.title
			projectData.description = starter.description
			projectData.requestedTier = STARTER_PROJECT_TIER
			break
		}

		case "project": {
			const title = sanitize(answer.title)
			if (!title) throw new HttpError("VALIDATION_FAILED", "Give your project a name")
			projectData.title = title
			projectData.description = sanitizeHtml(answer.description)
			// Writing your own description means you are no longer taking the starter build, so the tier stops being locked to 1.
			projectData.starterProjectId = null
			break
		}

		case "idea": {
			if (answer.starterProjectId === null) {
				projectData.starterProjectId = null
				break
			}
			// Only one this person was actually offered: the list depends on their answer to question one, and posting an id is not an answer.
			const starter = before.starterProjects.find(p => p.id === answer.starterProjectId)
			if (!starter) throw new HttpError("VALIDATION_FAILED", "That is not one of the suggestions")
			projectData.starterProjectId = starter.id
			projectData.title = starter.title
			projectData.description = starter.description
			// Taking a starter locks the request rather than merely defaulting it, so the tier step has nothing to decide.
			projectData.requestedTier = STARTER_PROJECT_TIER
			break
		}

		case "tier": {
			if (answer.requestedTier === null) {
				// Only the locked case may decline to choose: its tier was already written when the starter project was taken, so there is nothing left to answer. Anyone else is trying to skip the question.
				if (!before.project.tierLocked) throw new HttpError("VALIDATION_FAILED", "Pick one of the three tiers")
				break
			}
			if (before.project.tierLocked) {
				throw new HttpError(
					"VALIDATION_FAILED",
					"Starter projects are Tier 1. Write your own project idea to choose a different tier.",
				)
			}
			if (!isTierId(answer.requestedTier)) throw new HttpError("VALIDATION_FAILED", "Pick one of the three tiers")
			projectData.requestedTier = answer.requestedTier
			break
		}

		case "tracking":
			if (answer.dismissed) userData.trackingTutorialDismissedAt = new Date()
			break

		case "repo":
			// Nothing is written here. Turning the sync on is a GitHub round trip and can fail, and this state machine must not fail with it – see the AdvanceResult.repoRequest field, which the route acts on after the response has gone.
			break
	}

	// The step this answer lands on: normally the next one, further when the answer settles the steps in between (see above).
	const tookStarter = answer.step === "week" && typeof answer.starterProjectId === "string"
	const next = tookStarter ? stepIndexOf("tracking") : answer.step === "project" ? stepIndexOf("idea") + 1 : index + 1
	// Only ever forward: re-answering step 3 from step 5 must not rewind anyone. The transaction re-reads the marker and takes the max against its own fresh value.
	const userWrite = {
		data: {
			...userData,
			// Keeps the statement non-empty for an informational answer (the PCB week has no fields of its own) without writing the marker here; the guarded update below owns it.
			onboardingStep: { increment: 0 },
		},
		select: {
			hardwareExperience: true,
			onboardingCompletedAt: true,
			onboardingStep: true,
			trackingTutorialDismissedAt: true,
		},
		where: { id: userId },
	} as const
	const touchesProject = Object.keys(projectData).length > 0

	// Turning the sync on is a GitHub round trip that can fail, so it is not done here: this returns the request and the route performs it after the response has gone. That way a repo the token cannot push to refuses the *sync*, not the finishing of the setup flow.
	const repoRequest = answer.step === "repo" && answer.enabled && answer.repo ? { repo: answer.repo } : null

	const {
		projectAfter,
		userAfter,
		reached: reachedAfter,
	} = await prisma.$transaction(async tx => {
		// Re-read on the transaction client, so a concurrent step/project change cannot land a write against a stale snapshot.
		const txUser = await tx.user.findUniqueOrThrow({
			select: {
				hardwareExperience: true,
				onboardingCompletedAt: true,
				onboardingStep: true,
				trackingTutorialDismissedAt: true,
			},
			where: { id: userId },
		})
		const txProject = await tx.themeProject.findFirst({
			select: PROJECT_SELECT,
			where: { deletedAt: null, theme: before.theme, userId },
		})
		const freshReached = clampStep(txUser.onboardingStep)
		if (index > freshReached) throw new HttpError("VALIDATION_FAILED", "Finish the earlier steps first")

		const reachedNow = Math.max(freshReached, next)

		const targetProjectId = txProject?.id ?? before.project.id

		const projectAfter = touchesProject
			? await tx.themeProject.update({
					data: projectData,
					select: PROJECT_SELECT,
					where: { id: targetProjectId },
				})
			: (txProject ?? before.project)
		const userAfter = await tx.user.update({
			...userWrite,
			data: {
				...userWrite.data,
				...(reachedNow >= ONBOARDING_STEP_COUNT ? { onboardingCompletedAt: new Date() } : {}),
				onboardingStep: { increment: 0 },
			},
		})

		// Raise the furthest-reached marker, never lower it: two answers in flight read the same snapshot, and the slower one must not rewind the faster one.
		await tx.user.updateMany({
			data: { onboardingStep: reachedNow },
			where: { id: userId, onboardingStep: { lt: reachedNow } },
		})

		return { projectAfter, reached: reachedNow, userAfter }
	})

	const state: OnboardingState = {
		...before,
		completed: userAfter.onboardingCompletedAt !== null,
		current: stepAt(reachedAfter) ?? null,
		experience: userAfter.hardwareExperience,
		project: {
			...projectAfter,
			tierLocked: projectAfter.starterProjectId !== null,
		},
		reached: reachedAfter,
		// Re-read, not carried over: answering question one changes who is offered them.
		starterProjects: startersShownTo(userAfter.hardwareExperience, before.theme),
		suggestedTier: suggestedTierFor(userAfter.hardwareExperience),
		trackingDismissed: userAfter.trackingTutorialDismissedAt !== null,
	}

	return { completed: userAfter.onboardingCompletedAt !== null, repoRequest, state, touchedProject: touchesProject }
}

/**
 * Put someone back at the start of the first checkpoint, for an admin who wants to walk it again as a participant would.
 *
 * Only the progress and the answers the flow owns are cleared. The onboarding project keeps its row, name and entries, and the flow edits it in place as the questions are answered again; its starter pick is dropped so the tier is not left locked by an answer that no longer stands.
 */
export async function resetOnboarding(userId: string): Promise<void> {
	const project = await prisma.themeProject.findFirst({
		orderBy: { createdAt: "asc" },
		select: { theme: true },
		where: { deletedAt: null, theme: { not: Theme.WARMUP }, userId },
	})
	await prisma.$transaction([
		prisma.user.update({
			data: {
				hardwareExperience: null,
				onboardingCompletedAt: null,
				onboardingStep: 0,
				trackingTutorialDismissedAt: null,
			},
			where: { id: userId },
		}),
		...(project
			? [
					prisma.themeProject.updateMany({
						data: { starterProjectId: null },
						where: { deletedAt: null, theme: project.theme, userId },
					}),
				]
			: []),
	])
}

/**
 * Whether this participant should be sent through the first checkpoint.
 *
 * Anyone who has already started working is past it whatever the column says: the flow was added after the platform, and walking an existing participant through "make your first project" when they have three approved designs would be absurd. The check is deliberately generous for that reason.
 */
export async function needsOnboarding(userId: string): Promise<boolean> {
	const user = await prisma.user.findUnique({
		select: { onboardingCompletedAt: true },
		where: { id: userId },
	})
	if (!user || user.onboardingCompletedAt) return false

	const started = await prisma.themeProject.count({
		where: {
			deletedAt: null,
			OR: [
				{ designStatus: { not: PhaseStatus.draft } },
				{ buildStatus: { not: PhaseStatus.draft } },
				{ workSessions: { some: { deletedAt: null } } },
			],
			userId,
		},
	})
	return started === 0
}

export type { OnboardingStepId } from "@/lib/config/onboarding"
export { ONBOARDING_STEPS } from "@/lib/config/onboarding"
