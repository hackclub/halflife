import "dotenv/config"
import { Phase, PhaseStatus, PostKind, PostStatus, Theme } from "../src/lib/enums"
import db from "../src/lib/prisma8"
import { formatDbTimestamp } from "../src/lib/time"

/**
 * End-to-end check of the seam between the database and the trail.
 *
 * The platform derives its whole shape from one map of checkpoint states. If that map is built wrong, nothing throws and nothing fails to compile – the trail just quietly tells someone they have not done work they have done, or the reverse. So the mapping is asserted rather than trusted:
 *
 * 1. The Nth journal entry on the trail is the Nth session written, in order.
 * 2. A reel ticks the node it was posted for and NOT the others – the 5h and the 15h reel are both PROGRESS, so anything that counts by kind marks the 15h node done the moment the 5h one lands.
 * 3. Hours that never passed through a journal entry (Hackatime, reviewer adjustments) reach the week's total without moving an entry node, because progress reels are placed where the JOURNAL crossed their mark.
 * 4. A project nobody has named is not listed as one, but its id is still available to write to – the five rows exist from signup.
 *
 * Run with `pnpm verify:store` against a scratch database.
 */

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
	const pass = JSON.stringify(actual) === JSON.stringify(expected)
	if (!pass) failures++
	console.log(
		`${pass ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
	)
}

async function main() {
	const { getStoreSnapshot } = await import("../src/lib/queries/store")
	const { ensureThemeProject } = await import("../src/lib/provisioning")
	const { THEMES } = await import("../src/lib/config/program")

	const stamp = Date.now()
	const user = await db.orm.public.User.create({
		email: `store-check-${stamp}@example.test`,
		joinedProgramAt: formatDbTimestamp(new Date()),
		name: "Store Check",
		verificationStatus: "verified",
	})

	// Projects are created one at a time as their checkpoints are opened; opening one twice must still leave one row.
	for (const t of THEMES) await ensureThemeProject(user.id, t.id)
	for (const t of THEMES) await ensureThemeProject(user.id, t.id)
	const { made } = await db.orm.public.ThemeProject.where({ userId: user.id }).aggregate(a => ({ made: a.count() }))
	check("creating a project is idempotent", made, 5)

	const pcb = await db.orm.public.ThemeProject.where({ theme: Theme.PCB, userId: user.id }).firstOrThrow()

	// Nothing named yet: the row exists, but the trail must not claim it.
	const blank = await getStoreSnapshot(user.id)
	check("an unnamed project is not listed", blank.projects.length, 0)
	check("but its id is available to write to", blank.projectIdByWeek[1], pcb.id)
	check("no checkpoints are done", Object.keys(blank.progress).length, 0)

	await db.orm.public.ThemeProject.where({ id: pcb.id }).update({
		description: "Three keys.",
		requestedTier: 2,
		title: "Macropad",
	})

	// Three sessions, written in order. Their order IS the node order.
	for (const [index, hours] of [1.5, 2, 3].entries())
		await db.orm.public.WorkSession.create({
			content: `Body ${index + 1}`,
			createdAt: formatDbTimestamp(new Date(stamp + index * 1000)),
			effectiveDate: "2026-09-10",
			hoursClaimed: hours,
			phase: Phase.DESIGN,
			themeProjectId: pcb.id,
			title: `Session ${index + 1}`,
		})

	// Two reels, on nodes that are ten hours apart. Only one has been earned, and counting by kind would tick both.
	await db.orm.public.Post.create({
		caption: "Ten hours in.",
		checkpointKey: "w1-reel-1",
		kind: PostKind.PROGRESS,
		objectKey: `posts/${user.id}/a.mp4`,
		publishedAt: formatDbTimestamp(new Date()),
		status: PostStatus.PUBLISHED,
		themeProjectId: pcb.id,
		userId: user.id,
	})

	// Time that never passed through a journal entry.
	await db.orm.public.HackatimeLink.create({
		cachedSeconds: 7200,
		hackatimeProject: "macropad",
		phase: Phase.DESIGN,
		themeProjectId: pcb.id,
	})

	const snap = await getStoreSnapshot(user.id)

	check("the named project is listed", snap.projects.length, 1)
	check("at the week its theme is designed in", snap.projects[0]?.weekId, 1)
	check("with the tier they asked for", snap.projects[0]?.tier, 2)

	// A project can be handed in and rejected before a requested tier is ever recorded – the submit path falls back to Tier 1. It still has to appear, or the rejection has no surface on either the grid or its own page.
	const rejectedUser = await db.orm.public.User.create({
		email: `store-rejected-${stamp}@example.test`,
		joinedProgramAt: formatDbTimestamp(new Date()),
		name: "Rejected Check",
		verificationStatus: "verified",
	})
	const rejectedProject = await ensureThemeProject(rejectedUser.id, Theme.PCB)
	await db.orm.public.ThemeProject.where({ id: rejectedProject.id }).update({
		designStatus: PhaseStatus.rejected,
		title: "Rejected project",
	})
	const rejected = await getStoreSnapshot(rejectedUser.id)
	check("a rejected project with no requested tier is listed", rejected.projects.length, 1)
	check("and keeps its rejected state", rejected.projects[0]?.designStatus, PhaseStatus.rejected)
	check("with the tier the submit path fell back to", rejected.projects[0]?.tier, 1)

	check("entry 1 is the first session written", snap.progress["w1-entry-1"]?.minutes, 90)
	check("entry 2 is the second", snap.progress["w1-entry-2"]?.minutes, 120)
	check("entry 3 is the third", snap.progress["w1-entry-3"]?.minutes, 180)
	check("and there is no fourth", snap.progress["w1-entry-4"], undefined)

	check("the reel ticks its own node", snap.progress["w1-reel-1"]?.done, true)
	check("and not the next one", snap.progress["w1-reel-2"], undefined)
	check("nor the idea reel", snap.progress["w1-reel-idea"], undefined)

	// 2h of Hackatime, none of it in an entry.
	check("off-book hours reach the week", snap.offBookHours[1], 2)
	check("without inventing an entry", snap.progress["w1-entry-4"], undefined)

	check("the week is not submitted", snap.progress["w1-submit"], undefined)

	await db.orm.public.PhaseSubmission.create({ phase: Phase.DESIGN, themeProjectId: pcb.id })
	await db.orm.public.ThemeProject.where({ id: pcb.id }).update({ designStatus: PhaseStatus.in_review })

	const submitted = await getStoreSnapshot(user.id)
	check("submitting ticks the submit node", submitted.progress["w1-submit"]?.done, true)
	// The build half of the same theme is week 6 and must stay untouched: one project, two weeks, and a design submission is not a build submission.
	check("but not the build week's", submitted.progress["w6-submit"], undefined)

	// A phase sent back for changes is open again: the maker has to be able to log the work the reviewer asked for, and the trail cannot keep calling the week handed in.
	await db.orm.public.ThemeProject.where({ id: pcb.id }).update({ designStatus: PhaseStatus.update_requested })
	const returned = await getStoreSnapshot(user.id)
	check("a returned week unticks the submit node", returned.progress["w1-submit"], undefined)
	check("while keeping its existing entries", returned.progress["w1-entry-3"]?.done, true)
	const { checkpointsFor, WEEK_META } = await import("../src/lib/curriculum")
	const [firstWeek] = WEEK_META
	if (!firstWeek) throw new Error("the curriculum has no week 1")
	const returnedNodes = checkpointsFor(firstWeek, [90, 120, 180], id => returned.progress[id]?.done ?? false, 0, false)
	check(
		"and the trail offers the next journal entry",
		returnedNodes.some(c => c.id === "w1-entry-4"),
		true,
	)

	// ── The first checkpoint ──────────────────────────────────────────────────
	//
	// The store replays the modal's seven answers through the onboarding state machine one request at a time, because the machine refuses a step ahead of the furthest one reached. That refusal is what stops anyone arriving at a funded project without being asked what they are building – and it also means the store's sequence has to be exactly right, or onboarding never completes and the modal reappears forever with nothing in the log to say why. This replays that sequence in the order the store sends it.
	const { submitStep } = await import("../src/lib/onboarding")

	const fresh = await db.orm.public.User.create({
		email: `store-onboard-${stamp}@example.test`,
		joinedProgramAt: formatDbTimestamp(new Date()),
		name: "Onboard Check",
		verificationStatus: "verified",
	})
	// No project yet: onboarding is week one's "create a project" checkpoint and makes the PCB row itself.

	await submitStep(fresh.id, { experience: "A_LITTLE", step: "experience" })
	await submitStep(fresh.id, { step: "week" })
	await submitStep(fresh.id, {
		description: "My handle in copper.",
		step: "project",
		title: "Blinky badge",
	})
	await submitStep(fresh.id, { starterProjectId: null, step: "idea" })
	await submitStep(fresh.id, { requestedTier: 2, step: "tier" })
	await submitStep(fresh.id, { dismissed: false, step: "tracking" })
	await submitStep(fresh.id, { enabled: false, step: "repo" })

	const onboarded = await getStoreSnapshot(fresh.id)
	check("the store's sequence completes onboarding", onboarded.onboardingDone, true)
	check("which ticks the first checkpoint", onboarded.progress["w1-onboard"]?.done, true)
	check("and the project it created is on the trail", onboarded.projects[0]?.name, "Blinky badge")
	check("at the tier that was asked for", onboarded.projects[0]?.tier, 2)
	check("the experience answer stuck", onboarded.experience, "little")

	// ── Deduplication across projects ─────────────────────────────────────────
	//
	// A maker can journal and record a sitting in one week and link the tracked time on another. The recording and the link live on different rows, so nothing used to compare them and the sitting was paid for on both sides. The recording's own Hackatime project is what pairs them.
	const crossT = 1_700_000_000_000
	await db.orm.public.HackatimeLink.where({ themeProjectId: pcb.id }).updateAll({
		cachedSpans: {
			from: crossT / 1000 - 3600,
			spans: [{ end: crossT / 1000 + 7200, start: crossT / 1000 }],
			to: crossT / 1000 + 7200 + 3600,
		},
	})
	const cad = await db.orm.public.ThemeProject.where({ theme: Theme.CAD, userId: user.id }).firstOrThrow()
	const sitting = await db.orm.public.WorkSession.create({
		content: "Another week's sitting.",
		effectiveDate: "2026-09-11",
		hoursClaimed: 2,
		phase: Phase.BUILD,
		themeProjectId: cad.id,
		title: "Sitting",
	})
	await db.orm.public.SessionTimelapse.create({
		coveredSeconds: 7200,
		hackatimeProject: "macropad",
		provider: "lapse",
		recordedAt: formatDbTimestamp(new Date(crossT)),
		workSessionId: sitting.id,
	})

	const crossSnap = await getStoreSnapshot(user.id)
	check("a recording on another project deduplicates the link it names", crossSnap.offBookHours[1], 0)
	check("and the overlap is not flagged as unchecked", crossSnap.overlapUncheckedWeeks.includes(1), false)

	const { getHoursBreakdown } = await import("../src/lib/hours")
	const crossBreakdown = await getHoursBreakdown(pcb.id, Phase.DESIGN, { live: false })
	check("the ledger agrees: the link's overlap comes off", crossBreakdown.hackatimeHours, 0)
	check("and the subtracted overlap is reported", crossBreakdown.hackatimeOverlapSeconds, 7200)

	await db.orm.public.User.where({ id: fresh.id }).delete()
	await db.orm.public.User.where({ id: user.id }).delete()

	console.log(failures === 0 ? "\nAll store checks passed." : `\n${failures} check(s) failed.`)
	await db.close()
	process.exit(failures === 0 ? 0 : 1)
}

try {
	await main()
} catch (err) {
	console.error(err)
	await db.close()
	process.exit(1)
}
