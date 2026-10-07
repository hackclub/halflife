import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import { HardwareExperience, Theme } from "../src/app/generated/prisma/enums"

/**
 * End-to-end check of the first checkpoint.
 *
 * Two properties matter enough to assert rather than trust:
 *
 * 1. The flow cannot be skipped. Posting a later step than you have reached is refused, so nobody arrives at a funded project without having been asked what they are building.
 * 2. Onboarding never writes `ThemeProject.tier`. That column is the reviewer's decision and the number the grant is paid against; the participant's answer belongs in `requestedTier`. If these two ever merge, a participant is choosing their own funding.
 *
 * Run with `pnpm verify:onboarding` against a scratch database.
 */

const prisma = new PrismaClient({
	adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
	const pass = JSON.stringify(actual) === JSON.stringify(expected)
	if (!pass) failures++
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
	)
}

/** Runs `fn` and reports whether it threw, without letting it abort the run. */
async function refused(label: string, fn: () => Promise<unknown>): Promise<void> {
	let threw = false
	try {
		await fn()
	} catch {
		threw = true
	}
	check(label, threw, true)
}

async function main() {
	const { getOnboardingState, submitStep, needsOnboarding } = await import("../src/lib/onboarding")
	const { getStarterProject, starterProjectsFor } = await import("../src/lib/config/onboarding")

	const stamp = Date.now()
	const user = await prisma.user.create({
		data: {
			email: `onboarding-check-${stamp}@example.test`,
			name: "Onboarding Check",
			verificationStatus: "verified",
		},
	})

	// ── Starting state ─────────────────────────────────────────────────────────
	const start = await getOnboardingState(user.id)
	check("starts at step 0", start.reached, 0)
	check("first step is the experience question", start.current?.id, "experience")
	check("six steps", start.stepCount, 6)
	check("provisioned the PCB project", typeof start.project.id, "string")
	check("needs onboarding", await needsOnboarding(user.id), true)

	// Skipping ahead must fail: without this, a client could post the last step first and land on the dashboard having answered nothing.
	await refused("cannot answer a step it has not reached", () =>
		submitStep(user.id, { step: "tracking", dismissed: true }),
	)

	// ── 1. Experience ──────────────────────────────────────────────────────────
	const afterExperience = await submitStep(user.id, {
		step: "experience",
		experience: HardwareExperience.FIRST_TIME,
	})
	check("experience recorded", afterExperience.state.experience, HardwareExperience.FIRST_TIME)
	check("beginner is suggested Tier 1", afterExperience.state.suggestedTier, 1)
	check("advanced to the week step", afterExperience.state.current?.id, "week")

	// ── 2. Week intro: a beginner's fork, taking the starter ───────────────────
	const starters = starterProjectsFor(Theme.PCB)
	const starter = starters[0]
	if (!starter) throw new Error("no PCB starter projects configured")
	check("a first-timer is offered the starter", afterExperience.state.starterProjects[0]?.id, starter.id)

	await refused("rejects a starter id that does not exist", () =>
		submitStep(user.id, { step: "week", starterProjectId: "not-a-real-starter" }),
	)

	const afterStarter = await submitStep(user.id, { step: "week", starterProjectId: starter.id })
	check("starter names the project", afterStarter.state.project.title, starter.title)
	check("starter locks the tier", afterStarter.state.project.tierLocked, true)
	check("starter requests Tier 1", afterStarter.state.project.requestedTier, 1)
	check("starter goes straight to time tracking", afterStarter.state.current?.id, "tracking")

	// The tier step was skipped, not unlocked: still refused if posted.
	await refused("a locked project cannot request another tier", () =>
		submitStep(user.id, { step: "tier", requestedTier: 3 }),
	)

	// ── 2 again, and 3: their own project instead ────────────────────────────── Going back to make their own project has to release the lock, or someone who tried the starter is stuck at Tier 1 forever.
	const afterCustom = await submitStep(user.id, { step: "week", starterProjectId: null })
	check("choosing their own releases the lock", afterCustom.state.project.tierLocked, false)
	check("progress is not rewound by going back", afterCustom.state.reached, 5)

	const afterProject = await submitStep(user.id, {
		step: "project",
		title: "Mycelium sensor board",
		description: "A board that measures humidity in a grow bag.",
	})
	check("project title saved", afterProject.state.project.title, "Mycelium sensor board")
	check("tier is not locked by an own idea", afterProject.state.project.tierLocked, false)

	const afterTier = await submitStep(user.id, { step: "tier", requestedTier: 3 })
	check("unlocked project can request Tier 3", afterTier.state.project.requestedTier, 3)

	await refused("a made-up tier is rejected", () =>
		// Past the schema, which the route applies first; this is the state machine's own guard.
		submitStep(user.id, { step: "tier", requestedTier: 9 }),
	)

	// The invariant this whole split exists for.
	const project = await prisma.themeProject.findFirstOrThrow({
		where: { userId: user.id, theme: Theme.PCB },
		select: { tier: true, grantUsd: true, requestedTier: true },
	})
	check("onboarding never set the reviewer's tier", project.tier, null)
	check("onboarding never set a grant", project.grantUsd, null)
	check("the request is recorded separately", project.requestedTier, 3)

	// ── 6. Tracking, and completion ────────────────────────────────────────────
	const done = await submitStep(user.id, { step: "tracking", dismissed: true })
	check("completing reports completion", done.completed, true)
	check("state says completed", done.state.completed, true)
	check("no longer needs onboarding", await needsOnboarding(user.id), false)

	const finished = await prisma.user.findUniqueOrThrow({
		where: { id: user.id },
		select: { trackingTutorialDismissedAt: true, onboardingCompletedAt: true },
	})
	check("dismissal recorded", finished.trackingTutorialDismissedAt !== null, true)
	check("completion stamped", finished.onboardingCompletedAt !== null, true)

	await refused("a finished checkpoint refuses further answers", () =>
		submitStep(user.id, { step: "experience", experience: HardwareExperience.ITS_LIFE }),
	)

	// ── Someone experienced: no starter, and naming a project skips "Stuck?" ───
	const maker = await prisma.user.create({
		data: { email: `maker-${stamp}@example.test`, name: "Maker" },
	})
	const makerStart = await submitStep(maker.id, {
		step: "experience",
		experience: HardwareExperience.A_GOOD_AMOUNT,
	})
	check("an experienced maker is offered no starter", makerStart.state.starterProjects.length, 0)
	await refused("and cannot take one by posting its id", () =>
		submitStep(maker.id, { step: "week", starterProjectId: starter.id }),
	)
	await submitStep(maker.id, { step: "week" })
	const makerProject = await submitStep(maker.id, {
		step: "project",
		title: "Split keyboard",
		description: "Two halves, one cable.",
	})
	check("naming a project goes on to the tier, past the idea step", makerProject.state.current?.id, "tier")

	// ── Someone who was already working is never sent through it ───────────────
	const veteran = await prisma.user.create({
		data: { email: `veteran-${stamp}@example.test`, name: "Veteran" },
	})
	const veteranProject = await prisma.themeProject.create({
		data: { userId: veteran.id, theme: Theme.CAD, title: "Already going" },
	})
	await prisma.workSession.create({
		data: {
			themeProjectId: veteranProject.id,
			phase: "DESIGN",
			title: "Modelling",
			hoursClaimed: 3,
			effectiveDate: "2026-09-10",
		},
	})
	check("an existing participant is not sent through onboarding", await needsOnboarding(veteran.id), false)
	check("starter lookup round-trips", getStarterProject(starter.id)?.id, starter.id)

	// ── The goal gate the first checkpoint hands off to ──────────────────────── The prompt after onboarding is held open on one fact – participantGoal being null – and that fact has to travel with the account rather than with a browser, or a new laptop would let somebody past a question they have never been asked. These three are what that rests on.
	const asked = await prisma.user.create({
		data: {
			email: `goal-${stamp}@example.test`,
			name: "Goal Check",
			onboardingCompletedAt: new Date(),
			// No participantGoal: finished onboarding, not yet answered.
		},
	})
	const { getStoreSnapshot } = await import("../src/lib/queries/store")
	const unanswered = await getStoreSnapshot(asked.id)
	check("an unanswered goal is null, not defaulted", unanswered.participantGoal, null)
	check(
		"and that is what holds the prompt open",
		unanswered.onboardingDone && unanswered.participantGoal === null,
		true,
	)

	// Answering it is a plain write, and the gate opens the moment it lands.
	await prisma.user.update({ where: { id: asked.id }, data: { participantGoal: "FULL_FUNDING" } })
	const answered = await getStoreSnapshot(asked.id)
	check("answering closes the gate", answered.onboardingDone && answered.participantGoal === null, false)

	// A participant on the printer branch keeps their machine across a change of heart; nulling it here would hand them the default instead of their own.
	await prisma.user.update({ where: { id: asked.id }, data: { printerGoalId: "bambu-a1-mini" } })
	await prisma.user.update({ where: { id: asked.id }, data: { participantGoal: "PARTIAL_FUNDING" } })
	await prisma.user.update({ where: { id: asked.id }, data: { participantGoal: "PRINTER" } })
	const returned = await prisma.user.findUniqueOrThrow({
		where: { id: asked.id },
		select: { printerGoalId: true },
	})
	check("their own machine is still theirs after switching back", returned.printerGoalId, "bambu-a1-mini")

	await prisma.user.delete({ where: { id: user.id } })
	await prisma.user.delete({ where: { id: veteran.id } })
	await prisma.user.delete({ where: { id: asked.id } })

	console.log(failures === 0 ? "\nAll onboarding checks passed." : `\n${failures} check(s) failed.`)
	process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (err) => {
	console.error(err)
	await prisma.$disconnect()
	process.exit(1)
})
