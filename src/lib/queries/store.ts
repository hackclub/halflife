import "server-only"
import {
	HardwareExperience,
	HoursSource,
	type ParticipantGoal,
	Phase,
	PhaseStatus,
	Role,
	Theme,
} from "@/app/generated/prisma/enums"
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
import { rollUpHours } from "@/lib/hours"
import { getUserRoles, hasRole } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { effectiveDateFor, effectiveWeekClose, getProgramSettings, weekClosesAt, weekOpensAt } from "@/lib/program"
import { getOwedReelKeys } from "@/lib/reel-gate"
import { streakAsOf } from "@/lib/streak"
import { projectThumbnail } from "@/lib/thumbnail"
import type { Experience, Project, SessionLog } from "@/lib/types"
import { publicUrlFor } from "@/lib/uploads/r2"
import { warmupPhaseOf } from "@/lib/warmup"

/**
 * Everything the trail needs, read out of the database in one pass.
 *
 * ## The seam
 *
 * The platform UI derives its entire shape – how many nodes a week has, where
 * the progress reels fall, which one is live, what is locked and why – from one
 * record of checkpoint states, through `curriculum.checkpointsFor`. That
 * function is pure and already agrees with the program design, so the server's
 * only job is to say which checkpoints are done and with what, and let the
 * client derive the rest exactly as it did when the data was a toy.
 *
 * This is why the wedding is small. The alternative was a second checkpoint
 * engine on the server, and the first time the two disagreed the trail would
 * have lied to someone about work they had really done.
 *
 * ## What is NOT here
 *
 * The cinematic, the spotlight, the tab tour, and whether the Doomscroller rail
 * is open. Those are ceremony, they are per-device, and nobody else ever needs
 * to read them, so they stay in `localStorage` where a new laptop replays the
 * intro rather than inheriting a half-finished one. The server owns facts; the
 * browser owns ceremony.
 */

/** One checkpoint's state, in the shape the client store keeps them. */
export interface CheckpointSnapshot {
	done: boolean
	at?: number
	caption?: string
	minutes: number
	artefacts: number
	log: SessionLog[]
}

export interface StoreSnapshot {
	/** What the participant is here for, or null if not yet answered. */
	participantGoal: ParticipantGoal | null
	/**
	 * Who is signed in. Display fields only, never an email or a Slack id.
	 * `isAdmin` decides whether admin-only tools (redo onboarding) are offered;
	 * the routes behind them check the role themselves.
	 */
	viewer: { id: string; name: string; image: string | null; isAdmin: boolean }
	experience: Experience | null
	/** Whether the first checkpoint has been completed. */
	onboardingDone: boolean
	projects: Project[]
	/**
	 * Every theme project's id, by the design week it belongs to – including the
	 * ones not named yet.
	 *
	 * A row is made when its week's "create a project" checkpoint is opened
	 * (lib/provisioning), so a week that has not started has no id here; the
	 * client asks for one (ensureProject) when that checkpoint opens. `projects`
	 * leaves the unnamed ones out, or the trail would claim credit for a week
	 * that has only been looked at.
	 */
	projectIdByWeek: Record<number, string>
	progress: Record<string, CheckpointSnapshot>
	/**
	 * Hours a week has that did NOT come from its journal entries – Hackatime
	 * link time, and reviewer adjustments to it.
	 *
	 * Kept apart from the entries rather than folded into them because the two
	 * are used for different things. Reels are placed where the JOURNAL crossed
	 * a reel's mark, so that placement has to follow entries and nothing else; the
	 * gates ask what the week is really worth, which is everything. Folding
	 * Hackatime into an entry would move a reel to a node the participant never
	 * wrote.
	 */
	offBookHours: Record<number, number>
	/**
	 * Where each week's phase stands with review, by trail week.
	 *
	 * Coins are minted when a reviewer approves a phase, not when hours are
	 * logged, so the balance below trails the work by a review. Anything that
	 * asks "is this week on pace" has to add back what the unreviewed weeks will
	 * bank – and to know which weeks those are, it needs this.
	 */
	phaseStatusByWeek: Record<number, PhaseStatus>
	/**
	 * When each trail week stops taking work, epoch ms: 11:59 PM on its
	 * Sunday in the program timezone, pushed later by any extension on the
	 * participant or on that week's project. The server refuses journal writes
	 * past it, so the trail greys the week out at the same moment.
	 */
	weekClosesAt: Record<number, number>
	/**
	 * When each trail week starts taking work, epoch ms: midnight at the start
	 * of its Monday in the program timezone. Nothing on a week opens before it,
	 * the first checkpoint included, and the server refuses the same writes.
	 */
	weekOpensAt: Record<number, number>
	/** When warm-ups stop taking work, epoch ms: 11:59 PM the night before week 1 opens. */
	warmupsCloseAt: number
	/**
	 * Every warm-up project, by id: the one phase it is handed in as, the hours
	 * it has from somewhere other than its entries (Hackatime, reviewer
	 * adjustments), and when its journal closes. A maker may hold several, so
	 * each is addressed by its id – its entries and submit are `wu-<id>-…` keys
	 * in `progress` – never by a week number.
	 */
	warmups: Record<string, { phase: "design" | "build"; offBookHours: number; closesAt: number }>
	/** The program's IANA timezone, so the trail can name the day a week opens. */
	programTimezone: string
	/** The server's clock when this was read, so the first paint agrees with it. */
	now: number
	/** Ordinary coins. */
	coins: number
	/** The printer fund. Spendable on a printer and nothing else. */
	bankedCoins: number
	streak: number
	goalId: string
	/**
	 * Reel checkpoints whose reel was deleted and not yet re-recorded. While
	 * any are owed, they are the only checkpoints that open (lib/reel-gate).
	 */
	owedReels: string[]
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
	const [user, projects, sessions, links, posts, submissions, balances, settings, owedReels, roles] = await Promise.all(
		[
			prisma.user.findUniqueOrThrow({
				where: { id: userId },
				select: {
					name: true,
					displayName: true,
					image: true,
					slackId: true,
					hardwareExperience: true,
					onboardingCompletedAt: true,
					printerGoalId: true,
					participantGoal: true,
					currentStreak: true,
					lastStreakDate: true,
					submissionExtensionUntil: true,
				},
			}),
			prisma.themeProject.findMany({
				where: { userId, deletedAt: null },
				select: {
					id: true,
					theme: true,
					title: true,
					description: true,
					tier: true,
					requestedTier: true,
					starterProjectId: true,
					warmupPhase: true,
					githubRepo: true,
					coverImageKey: true,
					designStatus: true,
					buildStatus: true,
					designApprovedHours: true,
					approvedHours: true,
					submissionExtensionUntil: true,
				},
			}),
			// Ordered, because the trail's Nth entry node IS the Nth session written.
			prisma.workSession.findMany({
				where: { themeProject: { userId, deletedAt: null }, deletedAt: null },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				select: {
					id: true,
					themeProjectId: true,
					phase: true,
					content: true,
					title: true,
					hoursClaimed: true,
					hoursApproved: true,
					hoursSource: true,
					createdAt: true,
					media: { select: { objectKey: true } },
					timelapses: {
						select: { objectKey: true, externalId: true, coveredSeconds: true, recordedAt: true },
					},
				},
			}),
			prisma.hackatimeLink.findMany({
				where: { themeProject: { userId, deletedAt: null } },
				// cachedSpans comes along because `rollUpHours` is what the ledger
				// uses, and a trail that reported a different Hackatime total from the
				// one a reviewer approves is the disagreement this file already warns
				// about – the same minutes must not be payable twice on one screen and
				// once off it.
				select: {
					themeProjectId: true,
					phase: true,
					hoursApproved: true,
					cachedSeconds: true,
					cachedSpans: true,
				},
			}),
			prisma.post.findMany({
				// Every reel, not only the ones bound to a checkpoint: a project's
				// stand-in picture may come from any of them (see the thumbnail below).
				where: { userId, deletedAt: null },
				orderBy: { createdAt: "asc" },
				select: {
					checkpointKey: true,
					caption: true,
					createdAt: true,
					themeProjectId: true,
					thumbnailKey: true,
					objectKey: true,
				},
			}),
			prisma.phaseSubmission.findMany({
				where: { themeProject: { userId, deletedAt: null } },
				orderBy: { createdAt: "asc" },
				select: { themeProjectId: true, phase: true, createdAt: true },
			}),
			// Not in a transaction: this is a read for display, and BEGIN and COMMIT
			// are two more round trips to a database ~110ms away from a laptop –
			// the slowest part of the whole snapshot. Spending still reads its
			// balance inside the transaction that spends it.
			getBalances(prisma, userId),
			getProgramSettings(),
			getOwedReelKeys(userId),
			getUserRoles(userId),
		],
	)

	const byTheme = new Map(projects.map((p) => [p.theme, p]))
	const progress: Record<string, CheckpointSnapshot> = {}
	const offBookHours: Record<number, number> = {}
	const phaseStatusByWeek: Record<number, PhaseStatus> = {}

	// A reel posted twice for the same node keeps the newest caption; the rows are
	// ordered oldest-first, so the last write through this loop is the newest.
	// The node keeps the FIRST post's date, though, as the client's own patch
	// does: posting another reel adds to the timeline, it does not move the
	// checkpoint up it.
	for (const post of posts) {
		if (!post.checkpointKey) continue
		progress[post.checkpointKey] = {
			done: true,
			at: progress[post.checkpointKey]?.at ?? post.createdAt.getTime(),
			caption: post.caption,
			minutes: 0,
			artefacts: 1,
			log: [],
		}
	}

	if (user.onboardingCompletedAt) {
		progress[ONBOARDING_CHECKPOINT_ID] = {
			done: true,
			at: user.onboardingCompletedAt.getTime(),
			minutes: 0,
			artefacts: 0,
			log: [],
		}
	}

	// One phase of one project, written under the key prefix it is addressed
	// by: `w<week>` for a season week, `wu-<id>` for a warm-up project, which
	// has no week of its own. Returns the phase's off-book hours; a season week
	// also records them, and its status, against its week number.
	const recordPhase = (project: (typeof projects)[number], phase: Phase, prefix: string, week?: number): number => {
		{
			const id = (suffix: string) => `${prefix}-${suffix}`

			const phaseSessions = sessions.filter((s) => s.themeProjectId === project.id && s.phase === phase)
			const phaseLinks = links.filter((l) => l.themeProjectId === project.id && l.phase === phase)

			// Week one's project comes into existence through the first checkpoint
			// rather than a project form, so the node that stands for it is different
			// and is already recorded above. A warm-up has no such node at all.
			if (phase === Phase.DESIGN && week !== undefined && week > 1) {
				const tier = project.tier ?? project.requestedTier
				if (project.title && project.description && tier) {
					progress[id("project")] = {
						done: true,
						minutes: 0,
						artefacts: 0,
						log: [],
					}
				}
			}

			phaseSessions.forEach((session, index) => {
				progress[id(`entry-${index + 1}`)] = {
					done: true,
					at: session.createdAt.getTime(),
					minutes: minutesOf(session),
					artefacts: session.media.length,
					log: [
						{
							id: session.id,
							minutes: minutesOf(session),
							body: session.content ?? session.title,
							at: session.createdAt.getTime(),
							clips: session.timelapses.flatMap((t) => {
								const ref = t.externalId ?? t.objectKey
								return ref ? [ref] : []
							}),
						},
					],
				}
			})

			// The newest hand-in dates the node; the status says whether it stands.
			// A week taken back out of review (or reopened by an admin) is draft
			// again with its old submission rows still there, and it has to read as
			// not handed in, or the trail would hide the Submit it needs again.
			const submission = submissions.filter((s) => s.themeProjectId === project.id && s.phase === phase).at(-1)
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (week !== undefined) phaseStatusByWeek[week] = status
			if (status !== PhaseStatus.draft) {
				progress[id("submit")] = {
					done: true,
					at: submission?.createdAt.getTime(),
					minutes: 0,
					artefacts: 0,
					log: [],
				}
			}

			// What the phase is worth, minus what its entries already account for.
			// `rollUpHours` is the function the ledger uses, so the trail's gates and
			// the reviewer's totals cannot answer this differently.
			const frozen = phase === Phase.DESIGN ? project.designApprovedHours : project.approvedHours
			const { effectiveHours } = rollUpHours(phaseSessions, phaseLinks, frozen)
			// A HACKATIME_TRACKED entry contributes zero to `effectiveHours`, so it
			// must contribute zero here too, or the subtraction double-counts it.
			const entryHours = phaseSessions.reduce(
				(n, s) => n + (s.hoursSource === HoursSource.HACKATIME_TRACKED ? 0 : minutesOf(s) / 60),
				0,
			)
			const offBook = Math.max(0, round2(effectiveHours - entryHours))
			if (week !== undefined) offBookHours[week] = offBook
			return offBook
		}
	}

	THEMES.forEach((theme, themeIndex) => {
		const project = byTheme.get(theme.id)
		if (!project) return
		for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
			const week = weekOf(themeIndex, phase)
			recordPhase(project, phase, `w${week}`, week)
		}
	})

	// Each warm-up is one submission, so only its one phase goes on the record.
	// Its journal closes the night before week 1 opens (week 0's close), later
	// if extended.
	const warmups: StoreSnapshot["warmups"] = {}
	for (const project of projects) {
		if (project.theme !== Theme.WARMUP) continue
		const phase = warmupPhaseOf(project)
		warmups[project.id] = {
			phase: phase === Phase.BUILD ? "build" : "design",
			offBookHours: recordPhase(project, phase, `wu-${project.id}`),
			closesAt: effectiveWeekClose(
				weekClosesAt(settings, WARMUP_WEEK_ID),
				user.submissionExtensionUntil,
				project.submissionExtensionUntil,
			).getTime(),
		}
	}

	const projectIdByWeek: Record<number, string> = {}
	for (const project of projects) {
		// A warm-up project has no curriculum week to be addressed by, and a
		// maker may hold several of them, so week 0 would have to pick one of
		// them arbitrarily. They are reached through the projects list instead.
		if (project.theme === Theme.WARMUP) continue
		const themeIndex = THEMES.findIndex((t) => t.id === project.theme)
		if (themeIndex !== -1) projectIdByWeek[weekOf(themeIndex, Phase.DESIGN)] = project.id
	}

	const closes: Record<number, number> = {}
	const opens: Record<number, number> = {}
	for (let week = 1; week <= TOTAL_WEEKS; week += 1) {
		opens[week] = weekOpensAt(settings, week).getTime()
		const theme = scheduleForWeek(week)?.theme.id
		const project = theme ? byTheme.get(theme) : undefined
		closes[week] = effectiveWeekClose(
			weekClosesAt(settings, week),
			user.submissionExtensionUntil,
			project?.submissionExtensionUntil,
		).getTime()
	}

	return {
		viewer: {
			id: userId,
			name: displayName(user, "You"),
			image: avatarUrl(user),
			isAdmin: hasRole(roles, Role.ADMIN),
		},
		experience: user.hardwareExperience ? EXPERIENCE[user.hardwareExperience] : null,
		onboardingDone: user.onboardingCompletedAt !== null,
		// Null is the answer "not yet", and it is what holds the mandatory goal
		// prompt open. It is read here rather than derived from the ceremony
		// state because it is a fact about the person, not about this browser.
		participantGoal: user.participantGoal,
		projects: projects.flatMap((project) => {
			const warmup = project.theme === Theme.WARMUP
			const themeIndex = THEMES.findIndex((t) => t.id === project.theme)
			const tier = project.tier ?? project.requestedTier
			// A project whose checkpoint was opened but never finished is not one
			// the trail should list: the row exists from the moment "create a
			// project" is opened, before anything has been decided about it.
			if ((!warmup && themeIndex === -1) || !project.title || !tier) return []
			return [
				{
					id: project.id,
					name: project.title,
					description: project.description ?? "",
					weekId: warmup ? WARMUP_WEEK_ID : weekOf(themeIndex, Phase.DESIGN),
					tier: clampTier(tier),
					starter: project.starterProjectId !== null,
					starterProjectId: project.starterProjectId,
					githubRepo: project.githubRepo,
					coverImageKey: project.coverImageKey,
					designStatus: project.designStatus,
					buildStatus: project.buildStatus,
					thumbnail: projectThumbnail(
						publicUrlFor(project.coverImageKey),
						sessions.filter((s) => s.themeProjectId === project.id),
						posts
							.filter((p) => p.themeProjectId === project.id)
							.map((p) => ({
								createdAt: p.createdAt,
								thumbnailUrl: publicUrlFor(p.thumbnailKey),
								videoUrl: publicUrlFor(p.objectKey),
							})),
					),
				},
			]
		}),
		projectIdByWeek,
		progress,
		offBookHours,
		phaseStatusByWeek,
		weekClosesAt: closes,
		weekOpensAt: opens,
		warmupsCloseAt: weekClosesAt(settings, WARMUP_WEEK_ID).getTime(),
		warmups,
		programTimezone: settings.programTimezone,
		now: Date.now(),
		coins: balances.spendable,
		bankedCoins: balances.banked,
		streak: streakAsOf(user, effectiveDateFor(new Date(), settings.programTimezone)),
		goalId: user.printerGoalId ?? DEFAULT_GOAL_ID,
		owedReels,
	}
}

interface SessionRow {
	hoursClaimed: number
	hoursApproved: number | null
}

/** What a reviewer accepted, falling back to what was claimed. */
function minutesOf(session: SessionRow): number {
	return Math.round((session.hoursApproved ?? session.hoursClaimed) * 60)
}

function clampTier(tier: number): 1 | 2 | 3 {
	return tier === 2 || tier === 3 ? tier : 1
}

function round2(n: number): number {
	return Math.round(n * 100) / 100
}
