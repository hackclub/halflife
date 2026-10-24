import "server-only"
import { and } from "@prisma/orm-postgres/orm-client"
import { avatarUrl } from "@/lib/avatar"
import { DEFAULT_GOAL_ID } from "@/lib/config/printers"
import {
	DESIGN_WEEKS,
	ONBOARDING_CHECKPOINT_ID,
	scheduleForWeek,
	THEMES,
	TOTAL_WEEKS,
	WARMUP_WEEK_ID,
} from "@/lib/config/program"
import { getBalances } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
import { HardwareExperience, HoursSource, type ParticipantGoal, Phase, PhaseStatus, Role, Theme } from "@/lib/enums"
import { rollUpHours } from "@/lib/hours"
import { type RecordedWindow, timelapseWindow } from "@/lib/hours-overlap"
import { round2 } from "@/lib/money"
import { getUserRoles, hasRole } from "@/lib/permissions"
import db from "@/lib/prisma8"
import {
	effectiveDateFor,
	effectiveWeekClose,
	getProgramSettings,
	isPhaseDecided,
	weekClosesAt,
	weekOpensAt,
} from "@/lib/program"
import { getOwedReelKeys } from "@/lib/reel-gate"
import { withFields } from "@/lib/rows"
import { streakAsOf } from "@/lib/streak"
import { projectThumbnail } from "@/lib/thumbnail"
import { parseDbTimestamp } from "@/lib/time"
import type { Experience, Project, SessionLog } from "@/lib/types"
import { publicUrlFor } from "@/lib/uploads/r2"
import { warmupPhaseOf } from "@/lib/warmup"

/**
 * Everything the trail needs, read out of the database in one pass.
 *
 * ## The seam
 *
 * The platform UI derives its entire shape – how many nodes a week has, where the progress reels fall, which one is live, what is locked and why – from one record of checkpoint states, through `curriculum.checkpointsFor`. That
 * function is pure and already agrees with the program design, so the server's
 * only job is to say which checkpoints are done and with what, and let the client derive the rest exactly as it did when the data was a toy.
 *
 * This is why the wedding is small. The alternative was a second checkpoint engine on the server, and the first time the two disagreed the trail would have lied to someone about work they had really done.
 *
 * ## What is NOT here
 *
 * The cinematic, the spotlight, the tab tour, and whether the Doomscroller rail is open. Those are ceremony, they are per-device, and nobody else ever needs to read them, so they stay in `localStorage` where a new laptop replays the intro rather than inheriting a half-finished one. The server owns facts; the browser owns ceremony.
 */

/** One checkpoint's state, in the shape the client store keeps them. */
export interface CheckpointSnapshot {
	artefacts: number
	at?: number
	caption?: string
	done: boolean
	log: SessionLog[]
	minutes: number
}

export interface StoreSnapshot {
	/** The printer fund. Spendable on a printer and nothing else. */
	bankedCoins: number
	/** Ordinary coins. */
	coins: number
	experience: Experience | null
	goalId: string
	/** The server's clock when this was read, so the first paint agrees with it. */
	now: number
	/**
	 * Hours a week has that did NOT come from its journal entries – Hackatime link time, and reviewer adjustments to it.
	 *
	 * Kept apart from the entries rather than folded into them because the two are used for different things. Reels are placed where the JOURNAL crossed a reel's mark, so that placement has to follow entries and nothing else; the gates ask what the week is really worth, which is everything. Folding Hackatime into an entry would move a reel to a node the participant never wrote.
	 */
	offBookHours: { [_: number]: number }
	/** Whether the first checkpoint has been completed. */
	onboardingDone: boolean
	/**
	 * Trail weeks whose phase has a recording and links whose tracked intervals could not be read, so the overlap between the two could not be subtracted and the week's hours may still count one sitting twice.
	 *
	 * Reported rather than resolved: the dedupe needs a Hackatime answer, and where there is not one the honest thing is to say the number is unchecked rather than present it as fact. Screens showing a week total read this to say so.
	 */
	overlapUncheckedWeeks: number[]
	/**
	 * Reel checkpoints whose reel was deleted and not yet re-recorded. While any are owed, they are the only checkpoints that open (lib/reel-gate).
	 */
	owedReels: string[]
	/** What the participant is here for, or null if not yet answered. */
	participantGoal: ParticipantGoal | null
	/**
	 * Where each week's phase stands with review, by trail week.
	 *
	 * Coins are minted when a reviewer approves a phase, not when hours are logged, so the balance below trails the work by a review. Anything that asks "is this week on pace" has to add back what the unreviewed weeks will bank – and to know which weeks those are, it needs this.
	 */
	phaseStatusByWeek: { [_: number]: PhaseStatus }
	/** The program's IANA timezone, so the trail can name the day a week opens. */
	programTimezone: string
	progress: { [_: string]: CheckpointSnapshot }
	/**
	 * Every theme project's id, by the design week it belongs to – including the ones not named yet.
	 *
	 * A row is made when its week's "create a project" checkpoint is opened (lib/provisioning), so a week that has not started has no id here; the client asks for one (ensureProject) when that checkpoint opens. `projects` leaves the unnamed ones out, or the trail would claim credit for a week that has only been looked at.
	 */
	projectIdByWeek: { [_: number]: string }
	projects: Project[]
	streak: number
	/**
	 * Who is signed in. Display fields only, never an email or a Slack id. `isAdmin` decides whether admin-only tools (redo onboarding) are offered; the routes behind them check the role themselves.
	 */
	viewer: { id: string; name: string; image: string | null; isAdmin: boolean }
	/**
	 * Every warm-up project, by id: the one phase it is handed in as, the hours it has from somewhere other than its entries (Hackatime, reviewer adjustments), and when its journal closes. A maker may hold several, so each is addressed by its id – its entries and submit are `wu-<id>-…` keys in `progress` – never by a week number.
	 */
	warmups: { [_: string]: { phase: "design" | "build"; offBookHours: number; closesAt: number } }
	/** When warm-ups stop taking work, epoch ms: 11:59 PM the night before week 1 opens. */
	warmupsCloseAt: number
	/**
	 * When each trail week stops taking work, epoch ms: 11:59 PM on its Sunday in the program timezone, pushed later by any extension on the participant or on that week's project. The server refuses journal writes past it, so the trail greys the week out at the same moment.
	 */
	weekClosesAt: { [_: number]: number }
	/**
	 * Which weeks are racing an extension rather than their own Sunday, and whose: `"project"` when that week's own project carries it, `"account"` when the participant's own extension covers it – and that one reaches every week at once, which is exactly what makes a countdown on a later week look like it names the wrong day. Weeks that close on their own are absent.
	 */
	weekExtensions: { [_: number]: "account" | "project" }
	/**
	 * When each trail week starts taking work, epoch ms: midnight at the start of its Monday in the program timezone. Nothing on a week opens before it, the first checkpoint included, and the server refuses the same writes.
	 */
	weekOpensAt: { [_: number]: number }
}

const EXPERIENCE: Record<HardwareExperience, Experience> = {
	[HardwareExperience.FIRST_TIME]: "first",
	[HardwareExperience.A_LITTLE]: "little",
	[HardwareExperience.A_GOOD_AMOUNT]: "some",
	[HardwareExperience.ITS_LIFE]: "lots",
}

/** The program week a theme's phase is lived in. */
function weekOf(themeIndex: number, phase: Phase): number {
	return phase === Phase.DESIGN ? themeIndex + 1 : themeIndex + 1 + DESIGN_WEEKS
}

export async function getStoreSnapshot(userId: string): Promise<StoreSnapshot> {
	const parseNullable = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))
	const [userRow, projectRows, sessionRows, linkRows, postRows, submissionRows, balances, settings, owedReels, roles] =
		await Promise.all([
			db.orm.public.User.whereUnique({ id: userId })
				.select(
					"currentStreak",
					"displayName",
					"hardwareExperience",
					"id",
					"image",
					"lastStreakDate",
					"name",
					"onboardingCompletedAt",
					"participantGoal",
					"printerGoalId",
					"slackId",
					"submissionExtensionUntil",
				)
				.firstOrThrow(),
			db.orm.public.ThemeProject.where({ deletedAt: null, userId })
				.select(
					"approvedHours",
					"buildStatus",
					"coverImageKey",
					"description",
					"designApprovedHours",
					"designStatus",
					"githubRepo",
					"id",
					"namedAt",
					"requestedTier",
					"starterProjectId",
					"submissionExtensionUntil",
					"theme",
					"tier",
					"title",
					"warmupPhase",
				)
				.all(),
			// Ordered, because the trail's Nth entry node IS the Nth session written.
			db.orm.public.WorkSession.where({ deletedAt: null })
				.where(session =>
					session.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))),
				)
				.orderBy([session => session.createdAt.asc(), session => session.id.asc()])
				.select(
					"content",
					"createdAt",
					"hoursApproved",
					"hoursClaimed",
					"hoursSource",
					"id",
					"phase",
					"themeProjectId",
					"title",
				)
				.include("media", media => media.select("objectKey"))
				.include("timelapses", timelapse =>
					timelapse.select("coveredSeconds", "externalId", "hackatimeProject", "objectKey", "recordedAt"),
				)
				.all(),
			db.orm.public.HackatimeLink.where(link =>
				link.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))),
			)
				// cachedSpans comes along because `rollUpHours` is what the ledger uses, and a trail that reported a different Hackatime total from the one a reviewer approves is the disagreement this file already warns about – the same minutes must not be payable twice on one screen and once off it.
				.select("cachedSeconds", "cachedSpans", "hackatimeProject", "hoursApproved", "phase", "themeProjectId")
				.all(),
			db.orm.public.Post.where({ deletedAt: null, userId })
				.orderBy(post => post.createdAt.asc())
				.select("caption", "checkpointKey", "createdAt", "objectKey", "themeProjectId", "thumbnailKey")
				.all(),
			db.orm.public.PhaseSubmission.where(submission =>
				submission.themeProject.some(project => and(project.deletedAt.isNull(), project.userId.eq(userId))),
			)
				.orderBy(submission => submission.createdAt.asc())
				.select("createdAt", "phase", "themeProjectId")
				.all(),
			// Not in a transaction: this is a read for display, and BEGIN and COMMIT are two more round trips to a database ~110ms away from a laptop – the slowest part of the whole snapshot. Spending still reads its balance inside the transaction that spends it.
			getBalances(db, userId),
			getProgramSettings(),
			getOwedReelKeys(userId),
			getUserRoles(userId),
		])

	// Prisma 8 reads timestamps as PostgreSQL text; everything below works in Dates.
	const user = withFields(userRow, {
		onboardingCompletedAt: parseNullable(userRow.onboardingCompletedAt),
		submissionExtensionUntil: parseNullable(userRow.submissionExtensionUntil),
	})
	const projects = projectRows.map(project =>
		withFields(project, { submissionExtensionUntil: parseNullable(project.submissionExtensionUntil) }),
	)
	const sessions = sessionRows.map(session =>
		withFields(session, {
			createdAt: parseDbTimestamp(session.createdAt),
			timelapses: session.timelapses.map(timelapse =>
				withFields(timelapse, { recordedAt: parseNullable(timelapse.recordedAt) }),
			),
		}),
	)
	const posts = postRows.map(post => withFields(post, { createdAt: parseDbTimestamp(post.createdAt) }))
	const submissions = submissionRows.map(submission =>
		withFields(submission, { createdAt: parseDbTimestamp(submission.createdAt) }),
	)

	// Every recording this maker has, whatever project or phase it was attached to, each with the Hackatime project it named. A link finds the ones made under its own project by that name (`windowsForLink`), which is how a clip journalled in one week is deduplicated against a link in another.
	const recordings: RecordedWindow[] = sessions.flatMap(s =>
		s.hoursSource === HoursSource.HACKATIME_TRACKED
			? []
			: s.timelapses.flatMap(t => {
					const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
					return window ? [{ hackatimeProject: t.hackatimeProject, window }] : []
				}),
	)

	const byTheme = new Map(projects.map(p => [p.theme, p]))
	const progress: { [_: string]: CheckpointSnapshot } = {}
	const offBookHours: { [_: number]: number } = {}
	const overlapUncheckedWeeks: number[] = []
	const phaseStatusByWeek: { [_: number]: PhaseStatus } = {}

	// A reel posted twice for the same node keeps the newest caption; the rows are ordered oldest-first, so the last write through this loop is the newest. The node keeps the FIRST post's date, though, as the client's own patch does: posting another reel adds to the timeline, it does not move the checkpoint up it.
	for (const post of posts) {
		if (!post.checkpointKey) continue
		progress[post.checkpointKey] = {
			artefacts: 1,
			at: progress[post.checkpointKey]?.at ?? post.createdAt.getTime(),
			caption: post.caption,
			done: true,
			log: [],
			minutes: 0,
		}
	}

	if (user.onboardingCompletedAt)
		progress[ONBOARDING_CHECKPOINT_ID] = {
			artefacts: 0,
			at: user.onboardingCompletedAt.getTime(),
			done: true,
			log: [],
			minutes: 0,
		}

	// One phase of one project, written under the key prefix it is addressed by: `w<week>` for a season week, `wu-<id>` for a warm-up project, which has no week of its own. Returns the phase's off-book hours; a season week also records them, and its status, against its week number.
	const recordPhase = (project: (typeof projects)[number], phase: Phase, prefix: string, week?: number): number => {
		{
			const id = (suffix: string) => `${prefix}-${suffix}`

			const phaseSessions = sessions.filter(s => s.themeProjectId === project.id && s.phase === phase)
			const phaseLinks = linkRows.filter(l => l.themeProjectId === project.id && l.phase === phase)

			// Week one's project comes into existence through the first checkpoint rather than a project form, so the node that stands for it is different and is already recorded above. A warm-up has no such node at all.
			if (phase === Phase.DESIGN && week !== undefined && week > 1) {
				const tier = project.tier ?? project.requestedTier
				if (project.title && project.description && tier)
					progress[id("project")] = {
						artefacts: 0,
						done: true,
						log: [],
						minutes: 0,
					}
			}

			for (const [index, session] of phaseSessions.entries())
				progress[id(`entry-${index + 1}`)] = {
					artefacts: session.media.length,
					at: session.createdAt.getTime(),
					done: true,
					log: [
						{
							at: session.createdAt.getTime(),
							body: session.content ?? session.title,
							clips: session.timelapses.flatMap(t => {
								const ref = t.externalId ?? t.objectKey
								return ref ? [ref] : []
							}),
							id: session.id,
							minutes: minutesOf(session),
						},
					],
					minutes: minutesOf(session),
				}

			// The newest hand-in dates the node; the status says whether it stands. A week taken back out of review (or reopened by an admin) is `update_requested`, with its old submission rows still there, and it has to read as not handed in, or the trail would hide the live entry and the Submit it needs again. Decided phases and one still in review stay handed in. `findLast` and not `find`, because the rows come back oldest first and the newest hand-in is the one that counts.
			const submission = submissions.findLast(s => s.themeProjectId === project.id && s.phase === phase)
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (week !== undefined) phaseStatusByWeek[week] = status
			if (status === PhaseStatus.in_review || isPhaseDecided(status))
				progress[id("submit")] = {
					artefacts: 0,
					at: submission?.createdAt.getTime(),
					done: true,
					log: [],
					minutes: 0,
				}

			// What the phase is worth, minus what its entries already account for. `rollUpHours` is the function the ledger uses, so the trail's gates and the reviewer's totals cannot answer this differently.
			const frozen = phase === Phase.DESIGN ? project.designApprovedHours : project.approvedHours
			const { effectiveHours, hackatimeOverlapUnknown } = rollUpHours(phaseSessions, phaseLinks, frozen, recordings)
			// A HACKATIME_TRACKED entry contributes zero to `effectiveHours`, so it must contribute zero here too, or the subtraction double-counts it.
			const entryHours = phaseSessions.reduce(
				(n, s) => n + (s.hoursSource === HoursSource.HACKATIME_TRACKED ? 0 : minutesOf(s) / 60),
				0,
			)
			const offBook = Math.max(0, round2(effectiveHours - entryHours))
			if (week !== undefined) offBookHours[week] = offBook
			// Collected rather than warned about here: this snapshot feeds the trail and every project page, and the thing a participant needs to know is on the week total they are reading, not in a log.
			if (hackatimeOverlapUnknown && week !== undefined && !overlapUncheckedWeeks.includes(week))
				overlapUncheckedWeeks.push(week)
			return offBook
		}
	}

	for (const [themeIndex, theme] of THEMES.entries()) {
		const project = byTheme.get(theme.id)
		if (!project) continue
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const week = weekOf(themeIndex, phase)
			recordPhase(project, phase, `w${week}`, week)
		}
	}

	// Each warm-up is one submission, so only its one phase goes on the record. Its journal closes the night before week 1 opens (week 0's close), later if extended.
	const warmups: StoreSnapshot["warmups"] = {}
	for (const project of projects) {
		if (project.theme !== Theme.WARMUP) continue
		const phase = warmupPhaseOf(project)
		warmups[project.id] = {
			closesAt: effectiveWeekClose(
				weekClosesAt(settings, WARMUP_WEEK_ID),
				user.submissionExtensionUntil,
				project.submissionExtensionUntil,
			).getTime(),
			offBookHours: recordPhase(project, phase, `wu-${project.id}`),
			phase: phase === Phase.BUILD ? "build" : "design",
		}
	}

	const projectIdByWeek: { [_: number]: string } = {}
	for (const project of projects) {
		// A warm-up project has no curriculum week to be addressed by, and a maker may hold several of them, so week 0 would have to pick one of them arbitrarily. They are reached through the projects list instead.
		if (project.theme === Theme.WARMUP) continue
		const themeIndex = THEMES.findIndex(t => t.id === project.theme)
		if (themeIndex !== -1) projectIdByWeek[weekOf(themeIndex, Phase.DESIGN)] = project.id
	}

	const closes: { [_: number]: number } = {}
	const opens: { [_: number]: number } = {}
	// Which of those closes an extension pushed out, and whose it is. A project extension only reaches its own week; the account's reaches every week, so a later week's countdown would otherwise read as that week's own close.
	const weekExtensions: { [_: number]: "account" | "project" } = {}
	for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
		opens[week] = weekOpensAt(settings, week).getTime()
		const theme = scheduleForWeek(week)?.theme.id
		const project = theme ? byTheme.get(theme) : undefined
		const scheduled = weekClosesAt(settings, week).getTime()
		const projectExtension = project?.submissionExtensionUntil?.getTime() ?? null
		const close = effectiveWeekClose(
			new Date(scheduled),
			user.submissionExtensionUntil,
			project?.submissionExtensionUntil,
		).getTime()
		closes[week] = close
		if (close > scheduled)
			weekExtensions[week] = projectExtension !== null && projectExtension === close ? "project" : "account"
	}

	return {
		bankedCoins: balances.banked,
		coins: balances.spendable,
		experience: user.hardwareExperience ? EXPERIENCE[user.hardwareExperience] : null,
		goalId: user.printerGoalId ?? DEFAULT_GOAL_ID,
		now: Date.now(),
		offBookHours,
		onboardingDone: user.onboardingCompletedAt !== null,
		overlapUncheckedWeeks,
		owedReels,
		// Null is the answer "not yet", and it is what holds the mandatory goal prompt open. It is read here rather than derived from the ceremony state because it is a fact about the person, not about this browser.
		participantGoal: user.participantGoal,
		phaseStatusByWeek,
		programTimezone: settings.programTimezone,
		progress,
		projectIdByWeek,
		projects: projects.flatMap(project => {
			const warmup = project.theme === Theme.WARMUP
			const themeIndex = THEMES.findIndex(t => t.id === project.theme)
			const tier = project.tier ?? project.requestedTier
			// The row is made when its checkpoint is opened, before anything is decided about it. A project is started once it has been named or described, or has left draft; `tier` alone is not the signal, because a project can be submitted and rejected without a requested tier (the submit path falls back to Tier 1) and it has to stay visible with that rejection.
			const started =
				project.namedAt !== null
				|| Boolean(project.description?.trim())
				|| project.designStatus !== PhaseStatus.draft
				|| project.buildStatus !== PhaseStatus.draft
			if ((!warmup && themeIndex === -1) || !started) return []
			return [
				{
					buildStatus: project.buildStatus,
					coverImageKey: project.coverImageKey,
					description: project.description ?? "",
					designStatus: project.designStatus,
					githubRepo: project.githubRepo,
					id: project.id,
					name: project.title,
					starter: project.starterProjectId !== null,
					starterProjectId: project.starterProjectId,
					thumbnail: projectThumbnail(
						publicUrlFor(project.coverImageKey),
						sessions.filter(s => s.themeProjectId === project.id),
						posts
							.filter(p => p.themeProjectId === project.id)
							.map(p => ({
								createdAt: p.createdAt,
								thumbnailUrl: publicUrlFor(p.thumbnailKey),
								videoUrl: publicUrlFor(p.objectKey),
							})),
					),
					tier: clampTier(tier ?? 1),
					weekId: warmup ? WARMUP_WEEK_ID : weekOf(themeIndex, Phase.DESIGN),
				},
			]
		}),
		streak: streakAsOf(user, effectiveDateFor(new Date(), settings.programTimezone)),
		viewer: {
			id: userId,
			image: avatarUrl(user),
			isAdmin: hasRole(roles, Role.ADMIN),
			name: displayName(user, "You"),
		},
		warmups,
		warmupsCloseAt: weekClosesAt(settings, WARMUP_WEEK_ID).getTime(),
		weekClosesAt: closes,
		weekExtensions,
		weekOpensAt: opens,
	}
}

interface SessionRow {
	hoursApproved: number | null
	hoursClaimed: number
}

/** What a reviewer accepted, falling back to what was claimed. */
function minutesOf(session: SessionRow): number {
	return Math.round((session.hoursApproved ?? session.hoursClaimed) * 60)
}

function clampTier(tier: number): 1 | 2 | 3 {
	return tier === 2 || tier === 3 ? tier : 1
}
