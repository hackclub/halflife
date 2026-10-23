import "dotenv/config"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import { HardwareExperience, Theme } from "../src/app/generated/prisma/enums"
import { scheduleForWeek } from "../src/lib/config/program"

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

	// ── The week's starter ─────────────────────────────────────────────────────
	// The starter on offer is part of the curriculum, not an override: week 3 is Music, so its card is the MIDI keyboard. Starbie used to be listed for every theme without a starter of its own, which put a week-one guide on a week-three project. A theme reorder or a copied `themes` array is exactly how that comes back, so the pairing is asserted here rather than trusted.
	check("week 3 is Music", scheduleForWeek(3)?.theme.id, Theme.SYNTH)
	check(
		"week 3 offers the MIDI keyboard",
		starterProjectsFor(Theme.SYNTH).map(p => p.id),
		["midi"],
	)

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
	check("seven steps", start.stepCount, 7)
	check("provisioned the onboarding project", typeof start.project.id, "string")
	check("needs onboarding", await needsOnboarding(user.id), true)

	// Skipping ahead must fail: without this, a client could post the last step first and land on the dashboard having answered nothing.
	await refused("cannot answer a step it has not reached", () =>
		submitStep(user.id, { dismissed: true, step: "tracking" }),
	)

	// ── 1. Experience ──────────────────────────────────────────────────────────
	const afterExperience = await submitStep(user.id, {
		experience: HardwareExperience.FIRST_TIME,
		step: "experience",
	})
	check("experience recorded", afterExperience.state.experience, HardwareExperience.FIRST_TIME)
	check("beginner is suggested Tier 1", afterExperience.state.suggestedTier, 1)
	check("advanced to the week step", afterExperience.state.current?.id, "week")

	// ── 2. Week intro: a beginner's fork, taking the starter ───────────────────
	const starters = starterProjectsFor(afterExperience.state.theme)
	const [starter] = starters
	if (!starter) throw new Error("no starter projects configured for the onboarding theme")
	check("a first-timer is offered the starter", afterExperience.state.starterProjects[0]?.id, starter.id)

	await refused("rejects a starter id that does not exist", () =>
		submitStep(user.id, { starterProjectId: "not-a-real-starter", step: "week" }),
	)

	const afterStarter = await submitStep(user.id, { starterProjectId: starter.id, step: "week" })
	check("starter names the project", afterStarter.state.project.title, starter.title)
	check("starter locks the tier", afterStarter.state.project.tierLocked, true)
	check("starter requests Tier 1", afterStarter.state.project.requestedTier, 1)
	check("starter goes straight to time tracking", afterStarter.state.current?.id, "tracking")

	// The tier step was skipped, not unlocked: still refused if posted.
	await refused("a locked project cannot request another tier", () =>
		submitStep(user.id, { requestedTier: 3, step: "tier" }),
	)

	// ── 2 again, and 3: their own project instead ────────────────────────────── Going back to make their own project has to release the lock, or someone who tried the starter is stuck at Tier 1 forever.
	const afterCustom = await submitStep(user.id, { starterProjectId: null, step: "week" })
	check("choosing their own releases the lock", afterCustom.state.project.tierLocked, false)
	check("progress is not rewound by going back", afterCustom.state.reached, 5)

	const afterProject = await submitStep(user.id, {
		description: "A board that measures humidity in a grow bag.",
		step: "project",
		title: "Mycelium sensor board",
	})
	check("project title saved", afterProject.state.project.title, "Mycelium sensor board")
	check("tier is not locked by an own idea", afterProject.state.project.tierLocked, false)

	const afterTier = await submitStep(user.id, { requestedTier: 3, step: "tier" })
	check("unlocked project can request Tier 3", afterTier.state.project.requestedTier, 3)

	await refused("a made-up tier is rejected", () =>
		// Past the schema, which the route applies first; this is the state machine's own guard.
		submitStep(user.id, { requestedTier: 9, step: "tier" }),
	)

	// The invariant this whole split exists for.
	const project = await prisma.themeProject.findFirstOrThrow({
		select: { grantUsd: true, requestedTier: true, tier: true },
		where: { theme: start.theme, userId: user.id },
	})
	check("onboarding never set the reviewer's tier", project.tier, null)
	check("onboarding never set a grant", project.grantUsd, null)
	check("the request is recorded separately", project.requestedTier, 3)

	// ── 6. Tracking, then the repo step, and completion ─────────────────────────
	// Tracking is second-to-last: answering it moves on to the repo step, and
	// only the repo answer stamps the checkpoint complete.
	const afterTracking = await submitStep(user.id, { dismissed: true, step: "tracking" })
	check("tracking moves on to the repo step", afterTracking.state.current?.id, "repo")
	check("not complete before the last step", afterTracking.completed, false)
	const done = await submitStep(user.id, { enabled: false, step: "repo" })
	check("completing reports completion", done.completed, true)
	check("state says completed", done.state.completed, true)
	check("no longer needs onboarding", await needsOnboarding(user.id), false)

	const finished = await prisma.user.findUniqueOrThrow({
		select: { onboardingCompletedAt: true, trackingTutorialDismissedAt: true },
		where: { id: user.id },
	})
	check("dismissal recorded", finished.trackingTutorialDismissedAt !== null, true)
	check("completion stamped", finished.onboardingCompletedAt !== null, true)

	await refused("a finished checkpoint refuses further answers", () =>
		submitStep(user.id, { experience: HardwareExperience.ITS_LIFE, step: "experience" }),
	)

	// ── Someone experienced: no starter, and naming a project skips "Stuck?" ───
	const maker = await prisma.user.create({
		data: { email: `maker-${stamp}@example.test`, name: "Maker" },
	})
	const makerStart = await submitStep(maker.id, {
		experience: HardwareExperience.A_GOOD_AMOUNT,
		step: "experience",
	})
	check("an experienced maker is offered no starter", makerStart.state.starterProjects.length, 0)
	await refused("and cannot take one by posting its id", () =>
		submitStep(maker.id, { starterProjectId: starter.id, step: "week" }),
	)
	await submitStep(maker.id, { step: "week" })
	const makerProject = await submitStep(maker.id, {
		description: "Two halves, one cable.",
		step: "project",
		title: "Split keyboard",
	})
	check("naming a project goes on to the tier, past the idea step", makerProject.state.current?.id, "tier")

	// ── Someone who was already working is never sent through it ───────────────
	const veteran = await prisma.user.create({
		data: { email: `veteran-${stamp}@example.test`, name: "Veteran" },
	})
	const veteranProject = await prisma.themeProject.create({
		data: { theme: Theme.CAD, title: "Already going", userId: veteran.id },
	})
	await prisma.workSession.create({
		data: {
			effectiveDate: "2026-09-10",
			hoursClaimed: 3,
			phase: "DESIGN",
			themeProjectId: veteranProject.id,
			title: "Modelling",
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
	await prisma.user.update({ data: { participantGoal: "FULL_FUNDING" }, where: { id: asked.id } })
	const answered = await getStoreSnapshot(asked.id)
	check("answering closes the gate", answered.onboardingDone && answered.participantGoal === null, false)

	// A participant on the printer branch keeps their machine across a change of heart; nulling it here would hand them the default instead of their own.
	await prisma.user.update({ data: { printerGoalId: "bambu-a1-mini" }, where: { id: asked.id } })
	await prisma.user.update({ data: { participantGoal: "PARTIAL_FUNDING" }, where: { id: asked.id } })
	await prisma.user.update({ data: { participantGoal: "PRINTER" }, where: { id: asked.id } })
	const returned = await prisma.user.findUniqueOrThrow({
		select: { printerGoalId: true },
		where: { id: asked.id },
	})
	check("their own machine is still theirs after switching back", returned.printerGoalId, "bambu-a1-mini")

	await prisma.user.delete({ where: { id: user.id } })
	await prisma.user.delete({ where: { id: veteran.id } })
	await prisma.user.delete({ where: { id: asked.id } })

	console.log(failures === 0 ? "\nAll onboarding checks passed." : `\n${failures} check(s) failed.`)
	process.exit(failures === 0 ? 0 : 1)
}

try {
	await main()
} catch (err) {
	console.error(err)
	await prisma.$disconnect()
	process.exit(1)
}
