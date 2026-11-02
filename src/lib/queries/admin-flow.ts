import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import { STARTER_PROJECT_TIER, stepIndexOf } from "@/lib/config/onboarding"
import { getTier, isTierId } from "@/lib/config/tiers"
import { HoursSource, Phase, PostKind, ReviewResult } from "@/lib/enums"
import db from "@/lib/prisma8"
import { parseDbTimestamp } from "@/lib/time"

export interface SankeyNode {
	id: string
	label: string
	/** Users in this box. The sum over a stage is that stage's headcount, not the program total. */
	value: number
}

/** A ribbon: the users who go from one box to the next box they reach. */
export interface SankeyLink {
	/**
	 * Which edge fans: "out" nests at the source (one person repeated across every activity they reached), "in" nests at the target (the same people arriving through several activities). Chain ribbons carry disjoint users and stack on both edges.
	 *
	 * A pair of boxes always fans the same way: fan links touch exactly one activity box, so the direction is fixed by which end it is on.
	 */
	fan: "out" | "in" | null
	source: string
	target: string
	value: number
}

export interface SankeyStage {
	/** Column heading. */
	label: string
	/** Node ids in this column, top to bottom. The order is deliberate, not by size. */
	nodes: string[]
}

export interface SankeyDiagram {
	links: SankeyLink[]
	nodes: SankeyNode[]
	stages: SankeyStage[]
	/** Everyone who signed up: the width every ribbon is drawn against. */
	total: number
}

/** What share of onboarded finishers did each tracked activity: one maker counts in every column they reached. */
export interface ActivityShare {
	activities: { key: string; label: string; base: string; users: number; share: number }[]
	/** Makers who finished onboarding: the denominator every column reads against. */
	total: number
}

/**
 * The tracked-activity branches, in the order they stack. Each is its own ribbon rather than a funnel row, because a maker may do any combination of them – devlog and reel are not alternatives, so counting them as rows of one spine is what made the funnel wrong.
 */
const SANKEY_ACTIVITY = [
	{ base: "Devlog", key: "devlog", label: "Wrote a devlog" },
	{ base: "Reel", key: "reel", label: "Posted a reel" },
	{ base: "Repo", key: "repo", label: "Connected a repo" },
	{ base: "Hackatime", key: "hackatime", label: "Linked Hackatime" },
	{ base: "Timelapse", key: "timelapse", label: "Recorded a timelapse" },
] as const

type ActivityKey = (typeof SANKEY_ACTIVITY)[number]["key"]

type OutcomeNode = (typeof SANKEY_OUTCOME)[number]["node"]

/**
 * Box id for one activity. One stage, so one id per kind – a box is a rectangle with one x position, and every kind gets exactly one.
 */
const activityNode = (key: ActivityKey) => `act${SANKEY_ACTIVITY.find(a => a.key === key)?.base ?? "Unknown"}`

const activityNodes = () => SANKEY_ACTIVITY.map(a => activityNode(a.key))

/** The activity boxes, for recognising the fan stage when links are drawn. Includes the none box: it sits in the same column, though its links are exclusive like chain. */
const ACTIVITY_BOXES = new Set([...activityNodes(), "actNone"])

/** Finishers who reached none of the tracked activities. Its links are exclusive – one per person, like chain – never fanned. */
const NONE_BOX = "actNone"

const SANKEY_OUTCOME = [
	{ label: "Approved", node: "approved" },
	{ label: "Changes requested", node: "returned" },
	{ label: "Rejected", node: "rejected" },
	{ label: "Awaiting review", node: "awaiting" },
	{ label: "Never submitted", node: "notSubmitted" },
] as const

const SANKEY_STAGES: SankeyStage[] = [
	{ label: "Signed up", nodes: ["joined"] },
	{ label: "Logged in", nodes: ["loggedIn"] },
	{ label: "Started onboarding", nodes: ["setupStarted"] },
	{ label: "Reached the week step", nodes: ["reachedWeek"] },
	{ label: "Named a project", nodes: ["namedProject"] },
	{ label: "Reached the idea step", nodes: ["reachedIdea"] },
	{ label: "Picked a tier", nodes: ["pickedTier"] },
	{ label: "Reached tracking", nodes: ["reachedTracking"] },
	{ label: "Reached the repo step", nodes: ["reachedRepo"] },
	{ label: "Finished onboarding", nodes: ["setupDone"] },
	{ label: "Project", nodes: ["projectLive", "projectMissing"] },
	{ label: "Goal", nodes: ["goalSet", "goalMissing"] },
	{ label: "Activity", nodes: [...activityNodes(), NONE_BOX] },
	{ label: "Repo checks", nodes: ["checksPassed", "checksStalled"] },
	{ label: "Tier", nodes: ["tier1", "tier2", "tier3"] },
	{ label: "Tier hours", nodes: ["tierMet", "tierUnmet"] },
	{ label: "Hand-in", nodes: ["handedIn", "awaitingHandIn"] },
	{ label: "Outcome", nodes: SANKEY_OUTCOME.map(o => o.node) },
]

const SANKEY_LABELS: { [_: string]: string } = {
	awaitingHandIn: "Awaiting hand-in",
	checksPassed: "Checks passed",
	checksStalled: "Checks not passed",
	goalMissing: "No goal yet",
	goalSet: "Set a goal",
	handedIn: "Handed in for review",
	joined: "Signed up",
	loggedIn: "Logged in",
	namedProject: "Named a project",
	pickedTier: "Picked a tier",
	projectLive: "Project row live",
	projectMissing: "No project yet",
	reachedIdea: "Reached the idea step",
	reachedRepo: "Reached the repo step",
	reachedTracking: "Reached tracking",
	reachedWeek: "Reached the week step",
	setupDone: "Finished onboarding",
	setupStarted: "Started onboarding",
	tier1: "Tier 1",
	tier2: "Tier 2",
	tier3: "Tier 3",
	tierMet: "Met the hours",
	tierUnmet: "Short on hours",
	...Object.fromEntries(SANKEY_ACTIVITY.map(a => [activityNode(a.key), a.label])),
	[NONE_BOX]: "None of these",
	...Object.fromEntries(SANKEY_OUTCOME.map(o => [o.node, o.label])),
}

/**
 * Every row the journey is built from, read in one round trip.
 *
 * Read straight off the tables rather than the User analytics markers wherever a marker exists only after a backfill: the funnel needs `distinct: ["userId"]` on Session for the same reason. A missing analytics column must not silently read as "nobody did this".
 */
async function loadSankeyRows() {
	const [
		users,
		sessions,
		projects,
		devlogs,
		reels,
		repoLinks,
		hackatimeLinks,
		timelapses,
		submissions,
		designHours,
		designHackatime,
	] = await Promise.all([
		db.orm.public.User.select(
			"firstChecksPassedAt",
			"firstProjectAt",
			"hardwareExperience",
			"id",
			"onboardingCompletedAt",
			"onboardingStep",
			"participantGoal",
		).all(),
		// A sign-in is what issues a session. Read off the table rather than the `lastLoginAt` marker, so a backfill that never ran cannot read as "nobody logged in".
		db.orm.public.Session.distinct("userId").select("userId").all(),
		// The onboarding paper trail, per person, read off live projects. Not `namedAt`: that marker was stamped later, so it misses the projects that predate it. One read for all three, because the journey stages need them together.
		db.orm.public.ThemeProject.where({ deletedAt: null })
			.select("createdAt", "description", "id", "requestedTier", "starterProjectId", "userId")
			.all(),
		// The same "a real devlog" rule as the funnel's devlogged step: a HACKATIME_TRACKED row with no timelapse is only a link, not work.
		db.orm.public.WorkSession.where({ deletedAt: null })
			.where(session => or(session.hoursSource.neq(HoursSource.HACKATIME_TRACKED), session.timelapses.some()))
			.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
			.select("createdAt", "id")
			.include("themeProject", project => project.select("userId"))
			.all(),
		// A maker's own post, not a staff announcement: an announcement in their feed is not something they did.
		db.orm.public.Post.where({ deletedAt: null })
			.where(post => post.kind.neq(PostKind.ANNOUNCEMENT))
			.select("createdAt", "publishedAt", "userId")
			.all(),
		db.orm.public.ThemeProject.where({ deletedAt: null })
			.where(project =>
				or(project.githubRepo.isNotNull(), project.repoSyncRepo.isNotNull(), project.repoSyncEnabled.eq(true)),
			)
			.select("createdAt", "userId")
			.all(),
		db.orm.public.HackatimeLink.where(link => link.themeProject.some(project => project.deletedAt.isNull()))
			.select("createdAt", "id")
			.include("themeProject", project => project.select("userId"))
			.all(),
		db.orm.public.SessionTimelapse.where(timelapse =>
			timelapse.workSession.some(session =>
				and(
					session.deletedAt.isNull(),
					session.themeProject.some(project => project.deletedAt.isNull()),
				),
			),
		)
			.select("createdAt", "id")
			.include("workSession", session =>
				session.select("id").include("themeProject", project => project.select("userId")),
			)
			.all(),
		// The decision on each hand-in, to end the journey in an outcome rather than at "submitted".
		db.orm.public.PhaseSubmission.where(submission =>
			submission.themeProject.some(project => project.deletedAt.isNull()),
		)
			.select("resolvedAt", "resolvedResult")
			.include("themeProject", project => project.select("userId"))
			.all(),
		// Design hours per project, for the tier-requirements stage: journal claims outside the tracked-link stream, plus the Hackatime cache, so one wall hour is not counted twice in the common case. An approximation of the sheet's own arithmetic – reviewer adjustments and overlap edge cases stay server-side – but the right shape for "has this tier's floor been worked".
		db.orm.public.WorkSession.where({ deletedAt: null, phase: Phase.DESIGN })
			.where(session => session.hoursSource.neq(HoursSource.HACKATIME_TRACKED))
			.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
			.groupBy("themeProjectId")
			.aggregate(group => ({ hours: group.sum("hoursClaimed") })),
		db.orm.public.HackatimeLink.where({ phase: Phase.DESIGN })
			.where(link => link.themeProject.some(project => project.deletedAt.isNull()))
			.groupBy("themeProjectId")
			.aggregate(group => ({ seconds: group.sum("cachedSeconds") })),
	])

	return {
		designHackatime,
		designHours,
		devlogs,
		hackatimeLinks,
		projects,
		reels,
		repoLinks,
		sessions,
		submissions,
		timelapses,
		users,
	}
}

type SankeyRows = Awaited<ReturnType<typeof loadSankeyRows>>
type SankeyUser = SankeyRows["users"][number]

type ActivityMap = Map<string, Map<ActivityKey, Date>>

/**
 * Earliest occurrence of each activity per person. One Map of Maps, built from rows already tagged with their kind, so a kind needs no second pass.
 */
function earliestActivity(rows: SankeyRows): ActivityMap {
	const byUser: ActivityMap = new Map()
	const add = (userId: string, key: ActivityKey, at: Date) => {
		let seen = byUser.get(userId)
		if (!seen) {
			seen = new Map<ActivityKey, Date>()
			byUser.set(userId, seen)
		}
		const held = seen.get(key)
		if (!held || at < held) seen.set(key, at)
	}
	for (const session of rows.devlogs) {
		if (!session.themeProject) throw new Error(`session ${session.id} has no project`)
		add(session.themeProject.userId, "devlog", parseDbTimestamp(session.createdAt))
	}
	for (const post of rows.reels) add(post.userId, "reel", parseDbTimestamp(post.publishedAt ?? post.createdAt))
	for (const project of rows.repoLinks) add(project.userId, "repo", parseDbTimestamp(project.createdAt))
	for (const link of rows.hackatimeLinks) {
		if (!link.themeProject) throw new Error(`hackatime link ${link.id} has no project`)
		add(link.themeProject.userId, "hackatime", parseDbTimestamp(link.createdAt))
	}
	for (const timelapse of rows.timelapses) {
		if (!timelapse.workSession?.themeProject) throw new Error(`timelapse ${timelapse.id} has no project`)
		add(timelapse.workSession.themeProject.userId, "timelapse", parseDbTimestamp(timelapse.createdAt))
	}
	return byUser
}

/**
 * Each person's most recent decided or open hand-in, which is the one the outcome column should name.
 */
function latestOutcomes(submissions: SankeyRows["submissions"]): Map<string, OutcomeNode> {
	const OPEN = Number.NEGATIVE_INFINITY
	const held = new Map<string, { at: number; node: OutcomeNode }>()
	for (const row of submissions) {
		if (!row.themeProject) throw new Error("submission has no project")
		const at = row.resolvedAt === null ? OPEN : parseDbTimestamp(row.resolvedAt).getTime()
		const node = !row.resolvedResult
			? "awaiting"
			: row.resolvedResult === ReviewResult.APPROVED
				? "approved"
				: row.resolvedResult === ReviewResult.RETURNED
					? "returned"
					: "rejected"
		const previous = held.get(row.themeProject.userId)
		if (!previous || at > previous.at) held.set(row.themeProject.userId, { at, node })
	}
	return new Map([...held].map(([userId, handIn]) => [userId, handIn.node]))
}

/**
 * The tier each person is working at, and whether they have worked its floor: the chosen tier of their most recent live project (starters count as tier 1), against design journal hours plus Hackatime cache on that project. An approximation of the submit sheet's own arithmetic, documented where the hours are read – close enough for "will they be allowed to submit", which is what this stage asks.
 */
function tierProgress(rows: SankeyRows): { tierMet: Map<string, boolean>; userTier: Map<string, 1 | 2 | 3> } {
	const journalByProject = new Map(rows.designHours.map(row => [row.themeProjectId, row.hours ?? 0]))
	const hackByProject = new Map(rows.designHackatime.map(row => [row.themeProjectId, (row.seconds ?? 0) / 3600]))
	const latest = new Map<string, { createdAt: Date; project: SankeyRows["projects"][number]; tier: 1 | 2 | 3 }>()
	for (const project of rows.projects) {
		const raw = project.requestedTier ?? (project.starterProjectId !== null ? STARTER_PROJECT_TIER : null)
		if (!isTierId(raw)) continue
		const createdAt = parseDbTimestamp(project.createdAt)
		const held = latest.get(project.userId)
		if (!held || createdAt > held.createdAt) latest.set(project.userId, { createdAt, project, tier: raw })
	}
	const userTier = new Map<string, 1 | 2 | 3>()
	const tierMet = new Map<string, boolean>()
	for (const [userId, { project, tier }] of latest) {
		userTier.set(userId, tier)
		const floor = getTier(tier)?.fundingHours ?? 0
		const hours = (journalByProject.get(project.id) ?? 0) + (hackByProject.get(project.id) ?? 0)
		tierMet.set(userId, hours >= floor)
	}
	return { tierMet, userTier }
}

/** The per-user facts each column of the diagram asks about, built once and read by every person's boxes. */
interface JourneyLookups {
	activity: ActivityMap
	described: Set<string>
	liveProjectUsers: Set<string>
	loggedIn: Set<string>
	onboarding: { idea: number; repo: number; tracking: number; week: number }
	outcomeNode: Map<string, OutcomeNode>
	pickedTier: Set<string>
	tierMet: Map<string, boolean>
	tookStarter: Set<string>
	userTier: Map<string, 1 | 2 | 3>
}

function buildLookups(rows: SankeyRows, activity: ActivityMap): JourneyLookups {
	return {
		activity,
		// A project counts as described when it has a description or came from a starter – the same paper trail the onboarding stages read.
		described: new Set(
			rows.projects
				.filter(p => (p.description !== null && p.description !== "") || p.starterProjectId !== null)
				.map(p => p.userId),
		),
		// The journey stages before the branches. Read the same way the funnel reads them, so the two views line up on the path: a step is reached when the onboarding state machine is at or past it, and each accepts the branch that skips it (a starter pick jumps the project and idea questions) so nobody is drawn as having missed a step they were never asked.
		liveProjectUsers: new Set(rows.projects.map(p => p.userId)),
		loggedIn: new Set(rows.sessions.map(s => s.userId)),
		onboarding: {
			idea: stepIndexOf("idea"),
			repo: stepIndexOf("repo"),
			tracking: stepIndexOf("tracking"),
			week: stepIndexOf("week"),
		},
		outcomeNode: latestOutcomes(rows.submissions),
		pickedTier: new Set(rows.projects.filter(p => p.requestedTier !== null).map(p => p.userId)),
		...tierProgress(rows),
		tookStarter: new Set(rows.projects.filter(p => p.starterProjectId !== null).map(p => p.userId)),
	}
}

/** "tier1"…"tier3" for the stage, null when they never chose one. */
function tierBox(lookups: JourneyLookups, userId: string): string | null {
	const tier = lookups.userTier.get(userId)
	return tier === undefined ? null : `tier${tier}`
}

/** Whether the chosen tier's floor has been worked. Never set without the tier box above it. */
function metBox(lookups: JourneyLookups, userId: string): string | null {
	if (lookups.userTier.get(userId) === undefined) return null
	return lookups.tierMet.get(userId) === true ? "tierMet" : "tierUnmet"
}

/** Every tracked activity the person reached, in branch order so the boxes line up with the stage. One maker appears in as many boxes as they earned – or in the none box, when a finisher earned none. */
function activityBoxes(lookups: JourneyLookups, userId: string, completed: boolean): string[] {
	const did = SANKEY_ACTIVITY.filter(a => lookups.activity.get(userId)?.has(a.key)).map(a => activityNode(a.key))
	return did.length > 0 || !completed ? did : [NONE_BOX]
}

/** The person's box at each stage, null where they never got there. The activity boxes sit together as one block. */
function boxesOf(user: SankeyUser, lookups: JourneyLookups): (string | null)[] {
	const completed = user.onboardingCompletedAt !== null
	const started = user.hardwareExperience !== null || completed || user.firstProjectAt !== null
	const step = user.onboardingStep
	const reached = (n: number) => step >= n || completed
	return [
		"joined",
		lookups.loggedIn.has(user.id) ? "loggedIn" : null,
		started ? "setupStarted" : null,
		reached(lookups.onboarding.week) ? "reachedWeek" : null,
		lookups.described.has(user.id) || completed ? "namedProject" : null,
		reached(lookups.onboarding.idea) || lookups.tookStarter.has(user.id) ? "reachedIdea" : null,
		lookups.pickedTier.has(user.id) || lookups.tookStarter.has(user.id) || completed ? "pickedTier" : null,
		reached(lookups.onboarding.tracking) ? "reachedTracking" : null,
		reached(lookups.onboarding.repo) ? "reachedRepo" : null,
		completed ? "setupDone" : null,
		// The complements that make the gates visible: finishers who never got a project live, or never answered the goal prompt (mostly accounts from before it shipped – it cannot be dismissed now). Scoped to finishers so the boxes stay a finding about drop-off rather than everyone who never started.
		user.firstProjectAt !== null ? "projectLive" : completed ? "projectMissing" : null,
		user.participantGoal !== null ? "goalSet" : completed ? "goalMissing" : null,
		...activityBoxes(lookups, user.id, completed),
		// A project that never passed checks cannot be handed in – the sheet and the server both refuse it – so this box is the gate's bite: live projects stuck before review.
		user.firstChecksPassedAt !== null ? "checksPassed" : user.firstProjectAt !== null ? "checksStalled" : null,
		// The chosen tier of their latest project, and whether its funded hours have been worked – the two halves of "can they submit on it". No tier chosen, no boxes; the met box follows the tier box, never appears alone.
		tierBox(lookups, user.id),
		metBox(lookups, user.id),
		// Live project row, never submitted: the hand-in that is still awaited, distinct from never starting at all. Outcome below still reads never submitted – factually true – with this box saying they have something to hand in.
		lookups.outcomeNode.has(user.id) ? "handedIn" : lookups.liveProjectUsers.has(user.id) ? "awaitingHandIn" : null,
		lookups.outcomeNode.get(user.id) ?? "neverHandedIn",
	]
}

/**
 * Count the people in each box and the people on each ribbon.
 *
 * The activity block fans out and back in: one ribbon per activity the person reached, from their last box before the block and to their first box after it. Fan-out ribbons share their source's people and fan-in ribbons their target's, so each direction flags its own edge for the renderer to overlap; every other ribbon carries disjoint users and stacks.
 */
function countLinks(
	users: SankeyRows["users"],
	lookups: JourneyLookups,
): {
	counts: Map<string, number>
	linkCounts: Map<string, { fan: "out" | "in" | null; value: number }>
} {
	const counts = new Map<string, number>()
	const linkCounts = new Map<string, { fan: "out" | "in" | null; value: number }>()
	const link = (from: string, to: string, fan: "out" | "in" | null) => {
		const key = `${from}\u0000${to}`
		const held = linkCounts.get(key)
		if (held) held.value += 1
		else linkCounts.set(key, { fan, value: 1 })
	}
	for (const user of users) {
		const boxes = boxesOf(user, lookups).filter((box): box is string => box !== null)
		// Indices in this block are all guarded by the loop bounds and the activity search; the fallback only satisfies the checker.
		const boxAt = (index: number): string => boxes[index] ?? NONE_BOX
		for (const box of boxes) counts.set(box, (counts.get(box) ?? 0) + 1)
		const firstAct = boxes.findIndex(box => ACTIVITY_BOXES.has(box))
		if (firstAct === -1) {
			for (let i = 1; i < boxes.length; i++) link(boxAt(i - 1), boxAt(i), null)
			continue
		}
		let lastAct = firstAct
		while (lastAct + 1 < boxes.length && ACTIVITY_BOXES.has(boxAt(lastAct + 1))) lastAct++
		// "joined" is unconditional, so a block always has a box before it.
		const prev = boxAt(firstAct - 1)
		for (let i = 1; i < firstAct; i++) link(boxAt(i - 1), boxAt(i), null)
		for (let i = firstAct; i <= lastAct; i++) link(prev, boxAt(i), boxAt(i) === NONE_BOX ? null : "out")
		const next = boxes[lastAct + 1]
		if (next) {
			for (let i = firstAct; i <= lastAct; i++) link(boxAt(i), next, boxAt(i) === NONE_BOX ? null : "in")
			for (let i = lastAct + 2; i < boxes.length; i++) link(boxAt(i - 1), boxAt(i), null)
		}
	}
	return { counts, linkCounts }
}

// What share of onboarded finishers did each tracked activity: the same activity rows as the Sankey, cut to the people who finished onboarding rather than everyone who signed up. Largest first, so the chart reads left to right; ties keep branch order.
function buildActivityShare(users: SankeyRows["users"], activity: ActivityMap): ActivityShare {
	const finishers = users.filter(user => user.onboardingCompletedAt !== null)
	const reachedCount = (key: ActivityKey | "none") =>
		key === "none"
			? finishers.filter(user => !activity.get(user.id)).length
			: finishers.filter(user => activity.get(user.id)?.has(key)).length
	return {
		activities: [
			...SANKEY_ACTIVITY.map(a => {
				const reached = reachedCount(a.key)
				return {
					base: a.base,
					key: a.key,
					label: a.label,
					share: finishers.length === 0 ? 0 : reached / finishers.length,
					users: reached,
				}
			}),
			{
				base: "None",
				key: "none",
				label: "None of these",
				share: finishers.length === 0 ? 0 : reachedCount("none") / finishers.length,
				users: reachedCount("none"),
			},
		].toSorted((a, b) => b.users - a.users),
		total: finishers.length,
	}
}

/**
 * The journey as a Sankey: left-to-right columns of stages, a ribbon per route people actually took.
 *
 * This is the shape the funnel cannot draw. The funnel is one spine and every row is "also did everything above it", so it can only report cumulative survival – it cannot say that a quarter of makers journal and never post, nor that a maker who posted in week one and journalled in week four is the same shape as one who did it the other way round. Here each stage is a column and a skipped stage is a visible gap the ribbon steps over, and a fork is two ribbons of different widths rather than one number. The one exception is the activity stage, where a maker sits in every box they earned rather than at most one.
 *
 * Every stage except the first is optional, so a person contributes to the box they qualify for and the ribbon then jumps to the next stage they reach. A person who reached nothing after signing up is a ribbon that ends, which is a dead end the funnel has no way to draw.
 *
 * The journey stages are the funnel's own steps, in the funnel's order and read the funnel's way, so the two views can be laid side by side stage for stage: onboarding is broken out into each question the state machine records rather than collapsed into one "Setup" column. What the Sankey adds and the funnel cannot is the branch: one shared activity stage, where devlogs, Hackatime, Lapse and reels sit as ribbons of whatever width they really are, and an outcome column that says what happened to a hand-in rather than stopping at "submitted". The tracked-time evidence is drawn here and nowhere else – the funnel used to carry those rows as its own section, which put the same fact in two shapes that could not both be right.
 *
 * The activity stage counts every kind the person reached, not a ranked first and second: a maker who both journalled and linked Hackatime feeds both boxes, so the links around this one stage carry more units than the people. Each kind still contributes only its earliest timestamp to membership, so one prolific maker cannot fill a box twice – but order between kinds is deliberately unread: "devlog then reel" and "reel then devlog" are the same pair of ribbons now, because rank told us which came first and nothing about which mattered.
 */
export async function getUserFlowSankey(): Promise<{ activityShare: ActivityShare; diagram: SankeyDiagram }> {
	const rows = await loadSankeyRows()
	const activity = earliestActivity(rows)
	const lookups = buildLookups(rows, activity)
	const { counts, linkCounts } = countLinks(rows.users, lookups)

	// Only boxes someone actually reached are drawn: a branch nobody took is not a finding, and an empty box in the middle of the diagram reads as a bug.
	const nodes = SANKEY_STAGES.flatMap(stage =>
		stage.nodes
			.map(id => ({ id, label: SANKEY_LABELS[id] ?? id, value: counts.get(id) ?? 0 }))
			.filter(node => node.value > 0),
	)
	const live = new Set(nodes.map(n => n.id))

	return {
		activityShare: buildActivityShare(rows.users, activity),
		diagram: {
			links: [...linkCounts]
				.map(([key, entry]) => {
					const [source = "", target = ""] = key.split("\u0000")
					return { fan: entry.fan, source, target, value: entry.value }
				})
				.filter(edge => live.has(edge.source) && live.has(edge.target)),
			nodes,
			stages: SANKEY_STAGES,
			total: rows.users.length,
		},
	}
}
