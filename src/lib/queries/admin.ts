import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import {
	AuditAction,
	HoursSource,
	type PhaseStatus,
	PostKind,
	type ReportStatus,
	ReviewPass,
	ReviewResult,
	type ShopFulfillmentMethod,
	ShopFulfillmentStage,
	ShopOrderStatus,
	Theme,
} from "@/app/generated/prisma/enums"
import { getStarterProject, stepIndexOf } from "@/lib/config/onboarding"
import { getBalances } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
import { safeDecrypt } from "@/lib/pii"
import { getPrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"
import { getProgramSettings, startOfDay } from "@/lib/program"
import { countryOfTimezone, REGIONS, type RegionId, regionOfTimezone } from "@/lib/regions"
import { shopOrderStaffSelect } from "@/lib/shop"

export async function listUsers(
	opts: { q?: string; cursor?: string; limit: number },
	flags?: { includePii?: boolean },
) {
	const includePii = flags?.includePii ?? false
	const rows = await prisma.user.findMany({
		where: opts.q
			? {
					OR: [
						{ email: { contains: opts.q, mode: "insensitive" } },
						{ name: { contains: opts.q, mode: "insensitive" } },
						{ displayName: { contains: opts.q, mode: "insensitive" } },
						{ slackId: { contains: opts.q, mode: "insensitive" } },
					],
				}
			: undefined,
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: opts.limit + 1,
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
		select: {
			id: true,
			name: true,
			displayName: true,
			email: true,
			slackId: true,
			verificationStatus: true,
			fraudFlagged: true,
			createdAt: true,
			roles: { select: { role: true } },
		},
	})
	const hasMore = rows.length > opts.limit
	// Contact + risk fields only leave the server for ADMIN/AUDITOR. REVIEWER/FULFILLER get the directory (names + roles) with no emails, Slack ids or fraud flags to scrape. Callers pass includePii explicitly; the default is stripped.
	const items = (hasMore ? rows.slice(0, opts.limit) : rows).map((row) =>
		includePii ? row : { ...row, email: "", slackId: null, verificationStatus: null, fraudFlagged: false },
	)
	const last = items[items.length - 1]
	return { items, nextCursor: hasMore && last ? last.id : null }
}

export interface ProjectFilters {
	/** Matches the project's title, description or repo, or its owner's name, email or Slack ID. */
	q?: string
	theme?: Theme
	designStatus?: PhaseStatus
	buildStatus?: PhaseStatus
	tier?: number
	/** Only projects, or owners, with an extension still running. */
	extended?: boolean
	/**
	 * Include rows nobody has started. Every theme's row is made at sign-up, so without this the list is five placeholders per participant.
	 */
	unstarted?: boolean
}

export async function listProjects(opts: ProjectFilters & { cursor?: string; limit: number }) {
	const now = new Date()
	const q = opts.q?.trim()
	const where: Prisma.ThemeProjectWhereInput = {
		deletedAt: null,
		...(opts.unstarted ? {} : { namedAt: { not: null } }),
		...(opts.theme ? { theme: opts.theme } : {}),
		...(opts.designStatus ? { designStatus: opts.designStatus } : {}),
		...(opts.buildStatus ? { buildStatus: opts.buildStatus } : {}),
		...(opts.tier ? { OR: [{ tier: opts.tier }, { tier: null, requestedTier: opts.tier }] } : {}),
		AND: [
			q
				? {
						OR: [
							{ id: q },
							{ title: { contains: q, mode: "insensitive" } },
							{ description: { contains: q, mode: "insensitive" } },
							{ githubRepo: { contains: q, mode: "insensitive" } },
							{ user: { name: { contains: q, mode: "insensitive" } } },
							{ user: { displayName: { contains: q, mode: "insensitive" } } },
							{ user: { email: { contains: q, mode: "insensitive" } } },
							{ user: { slackId: { contains: q, mode: "insensitive" } } },
						],
					}
				: {},
			opts.extended
				? {
						OR: [{ submissionExtensionUntil: { gt: now } }, { user: { submissionExtensionUntil: { gt: now } } }],
					}
				: {},
		],
	}

	const rows = await prisma.themeProject.findMany({
		where,
		orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
		take: opts.limit + 1,
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
		select: {
			id: true,
			theme: true,
			title: true,
			githubRepo: true,
			designStatus: true,
			buildStatus: true,
			tier: true,
			requestedTier: true,
			submissionExtensionUntil: true,
			updatedAt: true,
			user: {
				select: {
					id: true,
					name: true,
					displayName: true,
					email: true,
					slackId: true,
					submissionExtensionUntil: true,
				},
			},
		},
	})
	const hasMore = rows.length > opts.limit
	const items = hasMore ? rows.slice(0, opts.limit) : rows
	const last = items[items.length - 1]
	return { items, nextCursor: hasMore && last ? last.id : null }
}

export async function getUserDetail(userId: string, flags?: { includeSensitive?: boolean }) {
	const includeSensitive = flags?.includeSensitive ?? false
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: {
			id: true,
			name: true,
			displayName: true,
			email: true,
			slackId: true,
			slackDisplayName: true,
			verificationStatus: true,
			hackatimeUserId: true,
			fraudFlagged: true,
			submissionExtensionUntil: true,
			createdAt: true,
			joinedProgramAt: true,
			roles: { select: { role: true, grantedAt: true, grantedBy: true } },
			themeProjects: {
				where: { deletedAt: null },
				select: {
					id: true,
					theme: true,
					title: true,
					designStatus: true,
					buildStatus: true,
					tier: true,
					grantUsd: true,
					approvedHours: true,
					designBankedCoins: true,
					designSpendableCoins: true,
					buildCoins: true,
					submissionExtensionUntil: true,
					hcbGrantTopUps: { where: { phase: "DESIGN", sentAt: { not: null } }, select: { id: true } },
				},
			},
			printerAward: true,
		},
	})
	if (!user) return null

	// Ledger, balances and order history only leave the server for ADMIN/AUDITOR – a FULFILLER (shipping role) needs the fulfilment sheet, not someone's full credit history. Stripped callers get the profile with contact/risk fields redacted and empty money sections.
	if (!includeSensitive) {
		const printer = await getPrinterQualification(userId)
		return {
			user: {
				...user,
				email: "",
				slackId: null,
				slackDisplayName: null,
				verificationStatus: null,
				hackatimeUserId: null,
				fraudFlagged: false,
			},
			balances: { spendable: 0, banked: 0, total: 0 },
			ledger: [],
			orders: [],
			printer,
		}
	}

	const [balances, ledger, orders, printer] = await Promise.all([
		prisma.$transaction((tx) => getBalances(tx, userId)),
		prisma.ledgerEntry.findMany({
			where: { userId },
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: 50,
		}),
		prisma.shopOrder.findMany({
			where: { userId },
			orderBy: { placedAt: "desc" },
			take: 25,
			// The user page lists the number, item, credit total and status only; internal cost and encrypted columns are not part of VIEW_USERS.
			select: { id: true, orderNumber: true, itemNameSnapshot: true, totalCredits: true, status: true },
		}),
		getPrinterQualification(userId),
	])

	return { user, balances, ledger, orders, printer }
}

export async function listOrders(opts: { status?: ShopOrderStatus; cursor?: string; limit: number }) {
	const rows = await prisma.shopOrder.findMany({
		where: opts.status ? { status: opts.status } : undefined,
		orderBy: [{ placedAt: "desc" }, { id: "desc" }],
		take: opts.limit + 1,
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
		// Explicit select, not `include`: a whole-row response carries the encrypted address/phone and `lastActorId` this API has no use for.
		select: {
			...shopOrderStaffSelect,
			user: { select: { id: true, name: true, displayName: true, email: true } },
			shopItem: { select: { id: true, name: true } },
		},
	})
	const hasMore = rows.length > opts.limit
	const items = hasMore ? rows.slice(0, opts.limit) : rows
	const last = items[items.length - 1]
	return { items, nextCursor: hasMore && last ? last.id : null }
}

/**
 * What the fulfilment sheet lists. Rejected orders were refunded and never ship; cancelled ones stay, since one may already be on its way to HQ.
 */
export const FULFILLMENT_ORDER_STATUSES: ShopOrderStatus[] = [
	ShopOrderStatus.PENDING,
	ShopOrderStatus.ON_HOLD,
	ShopOrderStatus.FULFILLED,
	ShopOrderStatus.CANCELLED,
]

/** A participant's cancellation wins over whatever stage was marked before it. */
export const fulfillmentStageOf = (order: {
	status: ShopOrderStatus
	fulfillmentStage: ShopFulfillmentStage
}): ShopFulfillmentStage =>
	order.status === ShopOrderStatus.CANCELLED ? ShopFulfillmentStage.CANCELLED : order.fulfillmentStage

export interface FulfillmentFilters {
	/** Inclusive, from the start of this instant. */
	placedFrom?: Date
	/** Exclusive. */
	placedBefore?: Date
	/** `"NONE"` is an order nobody has chosen a method for yet. */
	method?: ShopFulfillmentMethod | "NONE"
	stage?: ShopFulfillmentStage
}

/**
 * Orders for the fulfilment sheet, with each buyer's country.
 *
 * The country is the one on their HCA profile now, not at order time: it is what the parcel will actually be addressed to. It is decrypted here and only the plain country leaves this function – never the ciphertext.
 */
export async function listFulfillmentOrders(filters: FulfillmentFilters, opts: { cursor?: string; limit: number }) {
	const where: Prisma.ShopOrderWhereInput = {
		status: { in: FULFILLMENT_ORDER_STATUSES },
		...(filters.placedFrom || filters.placedBefore
			? {
					placedAt: {
						...(filters.placedFrom ? { gte: filters.placedFrom } : {}),
						...(filters.placedBefore ? { lt: filters.placedBefore } : {}),
					},
				}
			: {}),
		...(filters.method === "NONE"
			? { fulfillmentMethod: null }
			: filters.method
				? { fulfillmentMethod: filters.method }
				: {}),
		...(filters.stage === ShopFulfillmentStage.CANCELLED
			? {
					OR: [{ status: ShopOrderStatus.CANCELLED }, { fulfillmentStage: ShopFulfillmentStage.CANCELLED }],
				}
			: filters.stage
				? {
						fulfillmentStage: filters.stage,
						// A cancelled order shows as cancelled, so it matches no other stage.
						AND: [{ status: { not: ShopOrderStatus.CANCELLED } }],
					}
				: {}),
	}

	const rows = await prisma.shopOrder.findMany({
		where,
		orderBy: [{ placedAt: "desc" }, { id: "desc" }],
		take: opts.limit + 1,
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
		select: {
			id: true,
			orderNumber: true,
			quantity: true,
			itemNameSnapshot: true,
			unitCostUsd: true,
			status: true,
			fulfillmentMethod: true,
			fulfillmentStage: true,
			placedAt: true,
			shopItem: { select: { costUsd: true } },
			user: {
				select: { id: true, name: true, displayName: true, email: true, encryptedAddressCountry: true },
			},
		},
	})
	const hasMore = rows.length > opts.limit
	const page = hasMore ? rows.slice(0, opts.limit) : rows
	const last = page[page.length - 1]

	const items = page.map(({ shopItem, user, unitCostUsd, ...order }) => {
		// Orders from before the item had a cost fall back to today's.
		const unit = unitCostUsd ?? shopItem.costUsd
		return {
			...order,
			fulfillmentStage: fulfillmentStageOf(order),
			totalUsd: unit === null ? null : unit * order.quantity,
			country: safeDecrypt(user.encryptedAddressCountry),
			user: { id: user.id, name: displayName(user), email: user.email },
		}
	})
	return { items, nextCursor: hasMore && last ? last.id : null }
}

/** True for one of the recorded action names. Guards the audit-log filter. */
export function isAuditAction(value: string): value is AuditAction {
	return (Object.values(AuditAction) as string[]).includes(value)
}

export async function listAuditLog(opts: { action?: string; targetId?: string; cursor?: string; limit: number }) {
	const rows = await prisma.auditLog.findMany({
		where: {
			// The page's filter box takes free text, so an unrecognised action is treated as no filter rather than a Prisma enum error; the API route rejects it properly with a 400.
			...(opts.action && isAuditAction(opts.action) ? { action: opts.action } : {}),
			...(opts.targetId ? { targetId: opts.targetId } : {}),
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: opts.limit + 1,
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
	})
	const hasMore = rows.length > opts.limit
	const items = hasMore ? rows.slice(0, opts.limit) : rows
	const last = items[items.length - 1]
	return { items, nextCursor: hasMore && last ? last.id : null }
}

/**
 * Awards to ship, newest qualification first. `encryptedAddress` is read only to answer "is an address locked on file"; the ciphertext never leaves the server.
 */
export async function listPrinterAwards(limit = 100) {
	const rows = await prisma.printerAward.findMany({
		orderBy: [{ qualifiedAt: "desc" }],
		take: limit,
		select: {
			id: true,
			status: true,
			qualifiedAt: true,
			addressLockedAt: true,
			encryptedAddress: true,
			trackingNumber: true,
			trackingCarrier: true,
			shippedAt: true,
			deliveredAt: true,
			revokedAt: true,
			revokedReason: true,
			user: { select: { id: true, name: true, displayName: true, email: true } },
		},
	})
	return rows.map(({ encryptedAddress, ...award }) => ({
		...award,
		addressOnFile: encryptedAddress !== "",
	}))
}

/** Recent live reels, newest first, for the moderation panel. */
export async function listRecentPostsForModeration(limit = 25) {
	return prisma.post.findMany({
		where: { deletedAt: null },
		orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
		take: limit,
		select: {
			id: true,
			kind: true,
			caption: true,
			hiddenAt: true,
			hiddenReason: true,
			publishedAt: true,
			createdAt: true,
			user: { select: { id: true, name: true, displayName: true, email: true } },
			themeProject: { select: { id: true, title: true } },
		},
	})
}

/**
 * Recent live comments, newest first. A comment on a soft-deleted post is not shown – nobody can reach it to report it – but a hidden comment stays in the list so staff can see it was handled.
 */
export async function listRecentCommentsForModeration(limit = 25) {
	return prisma.postComment.findMany({
		where: { deletedAt: null, post: { deletedAt: null } },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: limit,
		select: {
			id: true,
			body: true,
			hiddenAt: true,
			hiddenReason: true,
			createdAt: true,
			user: { select: { id: true, name: true, displayName: true, email: true } },
			post: { select: { id: true, caption: true } },
		},
	})
}

/** Public reel links, newest first, so staff can find a post that went viral. */
export async function listRecentPublicReels(limit = 100) {
	return prisma.publicReel.findMany({
		orderBy: [{ postedAt: "desc" }, { id: "desc" }],
		take: limit,
		select: {
			id: true,
			url: true,
			platform: true,
			email: true,
			postedAt: true,
			user: { select: { id: true, name: true, displayName: true } },
			post: { select: { id: true, caption: true } },
			themeProject: { select: { id: true, title: true } },
		},
	})
}

export async function getAdminCounters() {
	const [pendingReviews, pendingOrders, participants, shipped] = await Promise.all([
		prisma.phaseSubmission.count({ where: { resolvedAt: null } }),
		prisma.shopOrder.count({ where: { status: ShopOrderStatus.PENDING } }),
		prisma.user.count(),
		prisma.printerAward.count({ where: { revokedAt: null } }),
	])
	return { pendingReviews, pendingOrders, participants, shipped }
}

export interface FlowStep {
	id: string
	label: string
	hint: string
	count: number
	/** Share of the previous step that made it down to this one. */
	retainPct: number
	/** Share of the previous step that stopped here. */
	dropOffPct: number
	/** Share of everyone who signed up that got this far. */
	ofSignupsPct: number
}

/**
 * The participant journey as a funnel. Each row counts people who ALSO did every step above it, so a step never has more people than the one before it and drop-off is never negative – whatever order things actually happened in.
 *
 * Steps with a named marker come from User (lib/analytics); "named a project" and the repo/devlog steps are derived from their own tables; "repo checks passed" is stamped by the preflight that gates submissions. The onboarding and goal steps in between are derived as noted below.
 *
 * The three reel steps that used to sit here ("started a reel upload", "uploaded a reel", "posted a reel") are gone. A funnel can only draw one spine, so putting reel posting on it said every maker who did not post a reel had dropped out, when a maker who is quietly journalling and building has not. Reel posting is one branch of the journey rather than a rung on it, and a branch is what the Sankey view draws: it can show a maker who added a devlog and posted a reel in either order, which a top-to-bottom funnel cannot represent at all.
 *
 * `posted` survives as a history guard on the onboarding and goal steps even now its own row is gone: the goal prompt shipped after the first reels, so "finished onboarding" and "set a goal" each mean "did this OR already did something later that presupposes it". Without the fallback, backfilling either column would silently shrink every step beneath it instead of showing a real drop.
 *
 * The last three rows are the tracked-time section: users with each kind of evidence that their hours were tracked – a Hackatime link, a timelapse, a manual devlog. They stay in the same cumulative chain as every other row (the component splits them off visually), so each counts submitters who also have that evidence, and "devlogged" there is the manual-session set from above.
 */
export async function getUserFlowFunnel(): Promise<FlowStep[]> {
	const [users, sessionUsers, projectUsers, devlogUsers, repoUsers, hackatimeLinkRows, timelapseRows] =
		await Promise.all([
			prisma.user.findMany({
				select: {
					id: true,
					hardwareExperience: true,
					onboardingStep: true,
					onboardingCompletedAt: true,
					participantGoal: true,
					firstProjectAt: true,
					firstReelAt: true,
					firstChecksPassedAt: true,
					firstSubmissionAt: true,
				},
			}),
			// People who logged in: a sign-in is what issues a session. Derived from the table rather than the lastLoginAt marker, so the funnel does not depend on the analytics backfill having run.
			prisma.session.findMany({ select: { userId: true }, distinct: ["userId"] }),
			// The onboarding paper trail, per person, read off their live projects: a description means they named something, a starter means they took one of the catalogue's, and a requested tier means they answered the tier question. One read for all three because the funnel needs them together.
			prisma.themeProject.findMany({
				where: { deletedAt: null },
				select: { userId: true, description: true, starterProjectId: true, requestedTier: true },
			}),
			// People who added a devlog: a project with a real work session on it.
			prisma.user.findMany({
				where: {
					themeProjects: {
						some: {
							deletedAt: null,
							// Same rule as the Loops lastEntryAt sync: a real entry is a session the maker wrote, or one carrying a timelapse. A HACKATIME_TRACKED row with no timelapse is only a link, not a devlog.
							workSessions: {
								some: {
									deletedAt: null,
									OR: [{ hoursSource: { not: HoursSource.HACKATIME_TRACKED } }, { timelapses: { some: {} } }],
								},
							},
						},
					},
				},
				select: { id: true },
			}),
			// People who connected a repository to a project.
			prisma.themeProject.findMany({
				where: {
					deletedAt: null,
					OR: [{ githubRepo: { not: null } }, { repoSyncRepo: { not: null } }, { repoSyncEnabled: true }],
				},
				select: { userId: true },
				distinct: ["userId"],
			}),
			// The tracked-time section: everyone with each kind of evidence that time was tracked. A Hackatime link backs one themed project and phase; a timelapse hangs off a session; the devlog set above covers the manual rows.
			prisma.hackatimeLink.findMany({
				where: { themeProject: { deletedAt: null } },
				select: { themeProject: { select: { userId: true } } },
			}),
			prisma.sessionTimelapse.findMany({
				where: { workSession: { deletedAt: null, themeProject: { deletedAt: null } } },
				select: { workSession: { select: { themeProject: { select: { userId: true } } } } },
			}),
		])

	const sessions = new Set(sessionUsers.map((s) => s.userId))
	const named = new Set(projectUsers.filter((p) => p.description !== null && p.description !== "").map((p) => p.userId))
	const tookStarter = new Set(projectUsers.filter((p) => p.starterProjectId !== null).map((p) => p.userId))
	const pickedTier = new Set(projectUsers.filter((p) => p.requestedTier !== null).map((p) => p.userId))
	const devlogs = new Set(devlogUsers.map((u) => u.id))
	const repos = new Set(repoUsers.map((u) => u.userId))
	const hackatimed = new Set(hackatimeLinkRows.map((l) => l.themeProject.userId))
	const lapsed = new Set(timelapseRows.map((t) => t.workSession.themeProject.userId))

	// One boolean per step per person, in funnel order; steps[0] (signup) is true for everyone. The `|| posted` / `|| submitted` fallbacks are the history guard described above the function – do not drop them.
	//
	// The onboarding steps between "started" and "finished" are read from `onboardingStep` (the furthest step reached, 0-based) rather than from a marker per step, because that one column is the state machine's own answer and predates nothing. Each carries `|| completed` so a person who finished is never missing from an earlier row, and each also accepts the branch that skips it: a starter pick jumps the project and idea steps, so "named or picked" and "tier settled" are ORs, not a single column.
	const ONBOARDING = {
		week: stepIndexOf("week"),
		idea: stepIndexOf("idea"),
		tracking: stepIndexOf("tracking"),
		repo: stepIndexOf("repo"),
	} as const
	const flags = users.map((u) => {
		const posted = u.firstReelAt !== null
		const submitted = u.firstSubmissionAt !== null
		const completed = u.onboardingCompletedAt !== null
		const step = u.onboardingStep
		const reached = (n: number) => step >= n || completed
		return [
			true,
			sessions.has(u.id),
			u.hardwareExperience !== null || completed || u.firstProjectAt !== null,
			reached(ONBOARDING.week),
			named.has(u.id) || tookStarter.has(u.id) || completed,
			reached(ONBOARDING.idea) || tookStarter.has(u.id),
			pickedTier.has(u.id) || tookStarter.has(u.id) || completed,
			reached(ONBOARDING.tracking),
			reached(ONBOARDING.repo),
			completed || posted || submitted,
			u.firstProjectAt !== null,
			u.participantGoal !== null || posted || submitted,
			devlogs.has(u.id),
			repos.has(u.id),
			u.firstChecksPassedAt !== null,
			submitted,
			hackatimed.has(u.id),
			lapsed.has(u.id),
			devlogs.has(u.id),
		]
	})
	const total = users.length

	const defs = [
		{ id: "signedUp", label: "Signed up", hint: "Account in the database" },
		{ id: "loggedIn", label: "Logged in", hint: "At least one sign-in" },
		{ id: "startedOnboarding", label: "Started onboarding", hint: "Answered the first getting-started question" },
		{ id: "reachedWeek", label: "Reached the week step", hint: "Saw what this week's theme is" },
		{
			id: "namedProject",
			label: "Named or picked a project",
			hint: "Described a project, or took a starter",
		},
		{ id: "reachedIdea", label: "Reached the idea step", hint: "Passed the project step to the starter ideas" },
		{ id: "pickedTier", label: "Picked a tier", hint: "Answered the tier question, or took a starter" },
		{ id: "reachedTracking", label: "Reached time tracking", hint: "Saw how hours are logged" },
		{ id: "reachedRepo", label: "Reached the repo step", hint: "Saw the optional repo-linking question" },
		{ id: "finishedOnboarding", label: "Finished onboarding", hint: "Worked through every getting-started step" },
		{ id: "createdProject", label: "Created a project", hint: "A project row with its first marker stamped" },
		{ id: "setGoal", label: "Set a goal", hint: "Answered what they are here for" },
		{ id: "addedDevlog", label: "Added a devlog", hint: "Logged a work session on a project" },
		{ id: "connectedRepo", label: "Connected a repo", hint: "Linked an external repository to a project" },
		{ id: "checksPassed", label: "Repo checks passed", hint: "Every submission repo check came back green" },
		{ id: "submitted", label: "Submitted a project", hint: "Handed a phase in for review" },
		{ id: "hackatimed", label: "Hackatimed", hint: "Linked a Hackatime project to a project" },
		{ id: "lapsed", label: "Lapsed", hint: "Attached a timelapse to a session" },
		{ id: "devlogged", label: "Devlogged", hint: "Logged a manual work session" },
	] as const

	const steps: FlowStep[] = []
	for (const [n, def] of defs.entries()) {
		let count = 0
		for (const f of flags) {
			let ok = true
			for (let k = 0; k <= n; k += 1) {
				if (!f[k]) {
					ok = false
					break
				}
			}
			if (ok) count += 1
		}
		const prev = n === 0 ? total : (steps[n - 1]?.count ?? total)
		steps.push({
			...def,
			count,
			retainPct: prev === 0 ? 0 : Math.round((count / prev) * 1000) / 10,
			dropOffPct: n === 0 || prev === 0 ? 0 : Math.round(((prev - count) / prev) * 1000) / 10,
			ofSignupsPct: total === 0 ? 0 : Math.round((count / total) * 1000) / 10,
		})
	}
	return steps
}

export type ReportStatusFilter = ReportStatus | "ALL"

/**
 * The moderation queue for user reports: who flagged what, why, and what staff did about it. Newest first, with the reported row's own preview and author alongside, so a report reads without opening five tabs. Cursor- paged like the audit log, so a busy queue never silently drops its tail.
 */
export async function listContentReports(
	status: ReportStatusFilter = "OPEN",
	opts: { cursor?: string; limit?: number } = {},
) {
	const limit = opts.limit ?? 50
	const rows = await prisma.contentReport.findMany({
		where: status === "ALL" ? undefined : { status },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: limit + 1,
		...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
		select: {
			id: true,
			target: true,
			reason: true,
			details: true,
			status: true,
			createdAt: true,
			resolvedAt: true,
			resolvedById: true,
			reporter: { select: { id: true, name: true, displayName: true, email: true } },
			post: {
				select: {
					id: true,
					caption: true,
					hiddenAt: true,
					deletedAt: true,
					user: { select: { id: true, name: true, displayName: true } },
				},
			},
			comment: {
				select: {
					id: true,
					body: true,
					hiddenAt: true,
					deletedAt: true,
					postId: true,
					user: { select: { id: true, name: true, displayName: true } },
				},
			},
			themeProject: {
				select: {
					id: true,
					title: true,
					deletedAt: true,
					user: { select: { id: true, name: true, displayName: true } },
				},
			},
			targetUser: { select: { id: true, name: true, displayName: true } },
			workSession: {
				select: {
					id: true,
					title: true,
					content: true,
					deletedAt: true,
					themeProject: {
						select: {
							id: true,
							title: true,
							user: { select: { id: true, name: true, displayName: true } },
						},
					},
				},
			},
		},
	})
	const hasMore = rows.length > limit
	const items = hasMore ? rows.slice(0, limit) : rows
	const last = items[items.length - 1]
	return { items, nextCursor: hasMore && last ? last.id : null }
}

export type ContentReportRow = Awaited<ReturnType<typeof listContentReports>>["items"][number]

export async function countContentReports(): Promise<Record<ReportStatus, number>> {
	const groups = await prisma.contentReport.groupBy({ by: ["status"], _count: { _all: true } })
	const counts: Record<ReportStatus, number> = { OPEN: 0, RESOLVED: 0, DISMISSED: 0 }
	for (const group of groups) counts[group.status] = group._count._all
	return counts
}

export interface AreaStat {
	id: RegionId
	label: string
	/** Accounts whose timezone maps here. */
	users: number
	/**
	 * Hours logged by those accounts: journal sessions (reviewer-adjusted where set) plus linked Hackatime time. A session already counted through a Hackatime link contributes nothing on its own, exactly as the ledger reads it.
	 */
	hours: number
}

export interface CountryStat {
	country: string
	/** Accounts whose timezone maps here. */
	users: number
	/** Hours logged by those accounts, as above. */
	hours: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * Users and hours per region, for the overview's geography section.
 *
 * Regions come from each account's timezone – the only per-user geography with real coverage (see lib/regions). Hours are attributed to the author's region, never to a project's.
 */
async function loadRegionInputs() {
	const [users, sessions, links] = await Promise.all([
		prisma.user.findMany({ select: { id: true, timezone: true } }),
		prisma.workSession.findMany({
			where: { deletedAt: null, themeProject: { deletedAt: null } },
			select: {
				hoursClaimed: true,
				hoursApproved: true,
				hoursSource: true,
				themeProject: { select: { userId: true } },
			},
		}),
		prisma.hackatimeLink.findMany({
			where: { themeProject: { deletedAt: null } },
			select: { hoursApproved: true, cachedSeconds: true, themeProject: { select: { userId: true } } },
		}),
	])
	return { users, sessions, links }
}

type RegionInputs = Awaited<ReturnType<typeof loadRegionInputs>>

/**
 * Hours per account, read the way the ledger reads them.
 *
 * One definition, shared by the geography panels and the hours distribution, so the two can never disagree about what "hours" means – a total that differed between two panels on the same page would be worse than either being wrong on its own.
 *
 * Reviewer-approved hours replace the claimed figure wherever set; a tracked entry's hours arrive through its link, so the journal row itself contributes nothing.
 */
function hoursByUser(inputs: RegionInputs): Map<string, number> {
	const hours = new Map<string, number>()
	const add = (userId: string, value: number) => hours.set(userId, (hours.get(userId) ?? 0) + value)

	for (const s of inputs.sessions) {
		if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
		add(s.themeProject.userId, s.hoursApproved ?? s.hoursClaimed)
	}
	for (const l of inputs.links) add(l.themeProject.userId, l.hoursApproved ?? (l.cachedSeconds ?? 0) / 3600)
	return hours
}

function aggregateByKey(inputs: RegionInputs, keyOf: (timezone: string | null) => string) {
	const userKey = new Map(inputs.users.map((u) => [u.id, keyOf(u.timezone)]))
	const totals = new Map<string, { users: number; hours: number }>()
	const row = (key: string) => {
		let r = totals.get(key)
		if (!r) {
			r = { users: 0, hours: 0 }
			totals.set(key, r)
		}
		return r
	}

	for (const u of inputs.users) row(userKey.get(u.id) ?? "Unknown").users += 1
	for (const [userId, hours] of hoursByUser(inputs)) row(userKey.get(userId) ?? "Unknown").hours += hours
	return totals
}

// Unknown always trails, whatever its size.
const rankLast = (key: string, users: number) => (key === "Unknown" ? -1 : users)

/** Users and hours per continent/area bucket. Ranked by users. */
export async function getAreaStats(): Promise<AreaStat[]> {
	const totals = aggregateByKey(await loadRegionInputs(), (tz) => regionOfTimezone(tz))
	return REGIONS.map(({ id, label }) => ({
		id,
		label,
		users: totals.get(id)?.users ?? 0,
		hours: round1(totals.get(id)?.hours ?? 0),
	})).sort((a, b) => rankLast(b.label, b.users) - rankLast(a.label, a.users))
}

/** Users and hours per country, from each account's timezone. Ranked by users. */
export async function getCountryStats(): Promise<CountryStat[]> {
	const totals = aggregateByKey(await loadRegionInputs(), countryOfTimezone)
	return [...totals]
		.filter(([, t]) => t.users > 0 || t.hours > 0)
		.map(([country, t]) => ({ country, users: t.users, hours: round1(t.hours) }))
		.sort((a, b) => rankLast(b.country, b.users) - rankLast(a.country, a.users))
}

export interface DayActivity {
	/** YYYY-MM-DD in the program timezone, as the journal stamped it. */
	day: string
	devlogs: number
	/** Journal hours that day, reviewer-adjusted where set. */
	hours: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Devlogs written and hours logged per day, gap-filled from the first active day to the last so the strip chart reads continuously. Days are program-timezone effective dates – the day the work counted for, not the instant it was typed.
 */
export async function getDailyActivity(): Promise<DayActivity[]> {
	const sessions = await prisma.workSession.findMany({
		where: { deletedAt: null, themeProject: { deletedAt: null } },
		select: { effectiveDate: true, hoursClaimed: true, hoursApproved: true, hoursSource: true },
	})

	const byDay = new Map<string, { devlogs: number; hours: number }>()
	for (const s of sessions) {
		const day = s.effectiveDate
		if (!day || !DAY.test(day)) continue
		let row = byDay.get(day)
		if (!row) {
			row = { devlogs: 0, hours: 0 }
			byDay.set(day, row)
		}
		row.devlogs += 1
		if (s.hoursSource !== HoursSource.HACKATIME_TRACKED) row.hours += s.hoursApproved ?? s.hoursClaimed
	}

	const days = [...byDay.keys()].sort()
	if (days.length === 0) return []
	const out: DayActivity[] = []
	const [first, last] = [days[0] as string, days[days.length - 1] as string]
	for (let at = Date.parse(`${first}T00:00:00Z`); at <= Date.parse(`${last}T00:00:00Z`); at += 86_400_000) {
		const day = new Date(at).toISOString().slice(0, 10)
		const row = byDay.get(day)
		out.push({
			day,
			devlogs: row?.devlogs ?? 0,
			hours: Math.round((row?.hours ?? 0) * 10) / 10,
		})
	}
	return out
}

export interface HoursBucket {
	/** The bucket as it reads on the axis, e.g. "10–20". */
	label: string
	/** Accounts whose total lands in this bucket. */
	participants: number
	/** Hours summed across the bucket. */
	hours: number
}

export interface HoursDistribution {
	buckets: HoursBucket[]
	/** Accounts with any hours at all – the histogram's denominator. */
	withHours: number
	/** Accounts with none. Most of them: everyone who signed up and never logged a devlog. */
	withoutHours: number
	median: number | null
	totalHours: number
}

/**
 * The upper bound of each bucket, in hours.
 *
 * Doubling rather than equal-width because the distribution is nothing like uniform: the median is around ten
 * hours and the top few participants have hundreds, so equal buckets would put nine tenths of everyone in the
 * first bar and push the rest off the end of the chart. The first bucket is open at zero because every account
 * here has at least some hours – the zero case is counted and reported rather than binned.
 */
const HOUR_EDGES = [1, 2, 5, 10, 20, 40, 80, 160, Number.POSITIVE_INFINITY]

/**
 * Hours per account, bucketed, for the overview's distribution.
 *
 * Reads the same ledger as the geography panels (see `hoursByUser`), so this and the continent and country pies
 * are the same hours counted two ways rather than two definitions that could drift apart.
 *
 * Accounts with no hours are a count and not a bar. At three quarters of all accounts, a zero bar would be four
 * times every other and answer a question nobody asked.
 */
export async function getHoursDistribution(): Promise<HoursDistribution> {
	const inputs = await loadRegionInputs()
	const perUser = [...hoursByUser(inputs).values()].filter((h) => h > 0).sort((a, b) => a - b)

	// One bucket per edge, so the trailing Infinity edge becomes the "160+" bar and catches the long tail.
	const last = HOUR_EDGES.length - 1
	const buckets: HoursBucket[] = HOUR_EDGES.map((upper, i) => ({
		label: i === last ? `${HOUR_EDGES[last - 1]}+` : i === 0 ? `under ${upper}` : `${HOUR_EDGES[i - 1]}–${upper}`,
		participants: 0,
		hours: 0,
	}))

	for (const hours of perUser) {
		const i = HOUR_EDGES.findIndex((upper) => hours < upper)
		const bucket = buckets[i === -1 ? last : i]
		if (!bucket) continue
		bucket.participants += 1
		bucket.hours += hours
	}

	const totalHours = perUser.reduce((n, h) => n + h, 0)
	const middle = Math.floor(perUser.length / 2)
	const median =
		perUser.length === 0
			? null
			: perUser.length % 2 === 1
				? (perUser[middle] as number)
				: ((perUser[middle - 1] as number) + (perUser[middle] as number)) / 2

	return {
		buckets,
		withHours: perUser.length,
		withoutHours: Math.max(0, inputs.users.length - perUser.length),
		median: median === null ? null : round1(median),
		totalHours: round1(totalHours),
	}
}

export interface FirstProjectStat {
	/** Starter title, or "Custom project" for a self-named idea. */
	label: string
	starter: boolean
	users: number
}

/**
 * What users chose for their first project: which starter, or a custom idea.
 *
 * Setup edits one row – the week-one (PCB) project – so its final `starterProjectId` is the choice: a starter id, or null for custom. Only users who finished setup and still have that project count; accounts with no week-one row made no choice in this system.
 */
export async function getFirstProjectStats(): Promise<FirstProjectStat[]> {
	const rows = await prisma.themeProject.findMany({
		where: { theme: Theme.PCB, deletedAt: null, user: { onboardingCompletedAt: { not: null } } },
		select: { starterProjectId: true },
	})

	const counts = new Map<string | null, number>()
	for (const r of rows) counts.set(r.starterProjectId, (counts.get(r.starterProjectId) ?? 0) + 1)

	// Starter ids outlive the catalogue: resolve a title when one exists, else show the id prettified rather than dropped.
	const pretty = (id: string) =>
		getStarterProject(id)?.title ??
		id
			.split(/[-_]/)
			.map((w) => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
			.join(" ")

	return [...counts]
		.filter(([, users]) => users > 0)
		.map(([starterId, users]) => ({
			label: starterId === null ? "Custom project" : pretty(starterId),
			starter: starterId !== null,
			users,
		}))
		.sort((a, b) => b.users - a.users)
}

export interface VerificationStat {
	label: string
	users: number
}

/**
 * How many accounts sit at each Hack Club Auth identity status.
 *
 * A breakdown rather than a single "verified" count, because the states either side of verified mean different things operationally: `needs_submission` is somebody mid-IDV who may yet be paid, `ineligible` is somebody who cannot be, and neither is simply "unverified".
 *
 * The status is HCA's own word, stored at each sign-in and submit by lib/hca-profile; a null is an account HCA has never answered for (a staff import nobody has signed in as, or an HCA that could not be reached).
 */
export async function getVerificationStats(): Promise<VerificationStat[]> {
	const rows = await prisma.user.groupBy({ by: ["verificationStatus"], _count: { _all: true } })
	return rows
		.filter((row) => row._count._all > 0)
		.map((row) => ({
			label:
				row.verificationStatus === null
					? "Not asked"
					: (VERIFICATION_STATUS_LABELS[row.verificationStatus] ?? row.verificationStatus),
			users: row._count._all,
		}))
		.sort((a, b) => b.users - a.users)
}

/**
 * HCA's own words for the states it reports. An unknown one is shown verbatim rather than dropped, so a status HCA adds later still shows up instead of vanishing into a hole in the ring.
 */
const VERIFICATION_STATUS_LABELS: Record<string, string> = {
	verified: "Verified",
	needs_submission: "Needs submission",
	pending: "Pending",
	ineligible: "Ineligible",
}

export interface ReviewerResultStat {
	result: ReviewResult
	/** Distinct projects whose most recent live review is this one, written today. */
	today: number
	/** The same, across the whole program. */
	total: number
}

export interface ReviewerStats {
	/** Distinct projects with a live review written today, program-timezone day. */
	reviewedToday: number
	/** Distinct projects carrying at least one live review. */
	reviewedTotal: number
	/** One row per outcome, so the rows add up to the two figures above them. */
	byResult: ReviewerResultStat[]
}

/**
 * How much has been reviewed, mirrored locally so the overview answers it without opening Ari.
 *
 * Counted over live decisions only. A review an admin un-approved or Ari reverted is marked `invalidated`, and a row that no longer stands is not a decision the project still has – counting it would make the total only ever grow and leave it disagreeing with Ari after a revert. Only FINAL passes count: a FIRST-pass row is advisory and moves no status and no money (see the ReviewPass enum), so including it would credit a reviewer with a decision they did not make.
 *
 * A project counts once however many of its phases were reviewed. A project is reviewed at most twice, design then build, and the question here is how much has had attention rather than how many hand-ins landed; `getAdminCounters`'s "awaiting review" remains the submission-level figure. The breakdown attributes each project to its most recent live review so the three outcome rows always add up to the headline above them: a project whose design was approved and whose build came back for changes reads as changes requested, which is where it actually stands.
 *
 * "Today" is the program timezone's day, the same boundary the activity strip and streaks use, so a review that landed at 11pm New York counts the day the dashboard is on rather than the server's.
 *
 * Ari's decisions are included – they reach this table through the same `finalizeReview` a console reviewer calls, and leaving them out is exactly the gap this closes.
 */
export async function getReviewerStats(): Promise<ReviewerStats> {
	const [{ programTimezone }, reviews] = await Promise.all([
		getProgramSettings(),
		prisma.submissionReview.findMany({
			where: { invalidated: false, pass: ReviewPass.FINAL, submission: { themeProject: { deletedAt: null } } },
			// Newest first, so the first row seen for a project is that project's most recent live review.
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			select: { result: true, createdAt: true, submission: { select: { themeProjectId: true } } },
		}),
	])

	const since = startOfDay(new Date(), programTimezone)
	const latest = new Map<string, { result: ReviewResult; today: boolean }>()
	for (const review of reviews) {
		const themeProjectId = review.submission.themeProjectId
		if (latest.has(themeProjectId)) continue
		latest.set(themeProjectId, { result: review.result, today: review.createdAt >= since })
	}

	const projects = [...latest.values()]
	return {
		// A project reviewed today can only have been reviewed today by its latest review, so this is the same set the breakdown counts.
		reviewedToday: projects.filter((p) => p.today).length,
		reviewedTotal: projects.length,
		byResult: Object.values(ReviewResult).map((result) => ({
			result,
			today: projects.filter((p) => p.result === result && p.today).length,
			total: projects.filter((p) => p.result === result).length,
		})),
	}
}

// ─── User-flow Sankey ─────────────────────────────────────────────────────────

/** One box in the Sankey: a group of users at one stage, with the people who will leave or join it. */
export interface SankeyNode {
	id: string
	label: string
	/** Users in this box. The sum over a stage is that stage's headcount, not the program total. */
	value: number
}

/** A ribbon: the users who go from one box to the next box they reach. */
export interface SankeyLink {
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
	stages: SankeyStage[]
	nodes: SankeyNode[]
	links: SankeyLink[]
	/** Everyone who signed up: the width every ribbon is drawn against. */
	total: number
}

/**
 * The tracked-activity branches, in the order they stack. Each is its own ribbon rather than a funnel row, because a maker may do any combination of them – devlog and reel are not alternatives, so counting them as rows of one spine is what made the funnel wrong.
 */
const SANKEY_ACTIVITY = [
	{ key: "devlog", base: "Devlog", label: "Wrote a devlog" },
	{ key: "reel", base: "Reel", label: "Posted a reel" },
	{ key: "repo", base: "Repo", label: "Connected a repo" },
	{ key: "hackatime", base: "Hackatime", label: "Linked Hackatime" },
	{ key: "timelapse", base: "Timelapse", label: "Recorded a timelapse" },
] as const

type ActivityKey = (typeof SANKEY_ACTIVITY)[number]["key"]

/**
 * Box id for one activity at one rank. The rank is in the id because the two activity columns cannot share boxes: a box is a rectangle with one x position, so one id per column is the whole point of a Sankey.
 */
const activityNode = (rank: number, key: ActivityKey) =>
	`act${rank}${SANKEY_ACTIVITY.find((a) => a.key === key)?.base ?? "Unknown"}`

const activityNodes = (rank: number) => SANKEY_ACTIVITY.map((a) => activityNode(rank, a.key))

const SANKEY_OUTCOME = [
	{ node: "approved", label: "Approved" },
	{ node: "returned", label: "Changes requested" },
	{ node: "rejected", label: "Rejected" },
	{ node: "awaiting", label: "Awaiting review" },
	{ node: "notSubmitted", label: "Never submitted" },
] as const

/**
 * The journey as a Sankey: left-to-right columns of stages, a ribbon per route people actually took.
 *
 * This is the shape the funnel cannot draw. The funnel is one spine and every row is "also did everything above it", so it can only report cumulative survival – it cannot say that a quarter of makers journal and never post, nor that a maker who posted in week one and journalled in week four is the same shape as one who did it the other way round. Here each stage is a column and a user is in at most one box per column, so a skipped stage is a visible gap the ribbon steps over and a fork is two ribbons of different widths rather than one number.
 *
 * Every stage except the first is optional, so a person contributes to the box they qualify for and the ribbon then jumps to the next stage they reach. A person who reached nothing after signing up is a ribbon that ends, which is a dead end the funnel has no way to draw.
 *
 * The journey stages are the funnel's own steps, in the funnel's order and read the funnel's way, so the two views can be laid side by side stage for stage: onboarding is broken out into each question the state machine records rather than collapsed into one "Setup" column, and the funnel's tracked-time rows stay as the activity branches below rather than being drawn twice. What the Sankey adds and the funnel cannot is the branch: the first two tracked activities as their own columns, and an outcome column that says what happened to a hand-in rather than stopping at "submitted".
 *
 * Every stage after the first is optional, so a person contributes to the box they qualify for and the ribbon then jumps to the next stage they reach. A person who reached nothing after signing up is a ribbon that ends, which is a dead end the funnel has no way to draw.
 *
 * The activity stages split by *rank*, not by type: a user's first tracked activity and then their second, so "devlog then reel" and "reel then devlog" are two different ribbons and can be read apart. Each kind contributes only its earliest timestamp, so one prolific maker cannot fill three boxes.
 *
 * Read straight off the tables rather than the User analytics markers wherever a marker exists only after a backfill: the funnel needs `distinct: ["userId"]` on Session for the same reason. A missing analytics column must not silently read as "nobody did this".
 */
export async function getUserFlowSankey(): Promise<SankeyDiagram> {
	const [users, sessions, projects, devlogs, reels, repoLinks, hackatimeLinks, timelapses, submissions] =
		await Promise.all([
			prisma.user.findMany({
				select: {
					id: true,
					hardwareExperience: true,
					onboardingStep: true,
					onboardingCompletedAt: true,
					participantGoal: true,
					firstProjectAt: true,
					firstChecksPassedAt: true,
				},
			}),
			// A sign-in is what issues a session. Read off the table rather than the `lastLoginAt` marker, so a backfill that never ran cannot read as "nobody logged in".
			prisma.session.findMany({ select: { userId: true }, distinct: ["userId"] }),
			// The onboarding paper trail, per person, read off live projects. Not `namedAt`: that marker was stamped later, so it misses the projects that predate it. One read for all three, because the journey stages need them together.
			prisma.themeProject.findMany({
				where: { deletedAt: null },
				select: { userId: true, description: true, starterProjectId: true, requestedTier: true },
			}),
			// The same "a real devlog" rule as the funnel's devlogged step: a HACKATIME_TRACKED row with no timelapse is only a link, not work.
			prisma.workSession.findMany({
				where: {
					deletedAt: null,
					themeProject: { deletedAt: null },
					OR: [{ hoursSource: { not: HoursSource.HACKATIME_TRACKED } }, { timelapses: { some: {} } }],
				},
				select: { createdAt: true, themeProject: { select: { userId: true } } },
			}),
			// A maker's own post, not a staff announcement: an announcement in their feed is not something they did.
			prisma.post.findMany({
				where: { deletedAt: null, kind: { not: PostKind.ANNOUNCEMENT } },
				select: { userId: true, publishedAt: true, createdAt: true },
			}),
			prisma.themeProject.findMany({
				where: {
					deletedAt: null,
					OR: [{ githubRepo: { not: null } }, { repoSyncRepo: { not: null } }, { repoSyncEnabled: true }],
				},
				select: { createdAt: true, userId: true },
			}),
			prisma.hackatimeLink.findMany({
				where: { themeProject: { deletedAt: null } },
				select: { createdAt: true, themeProject: { select: { userId: true } } },
			}),
			prisma.sessionTimelapse.findMany({
				where: { workSession: { deletedAt: null, themeProject: { deletedAt: null } } },
				select: { createdAt: true, workSession: { select: { themeProject: { select: { userId: true } } } } },
			}),
			// The decision on each hand-in, to end the journey in an outcome rather than at "submitted".
			prisma.phaseSubmission.findMany({
				where: { themeProject: { deletedAt: null } },
				select: { resolvedAt: true, resolvedResult: true, themeProject: { select: { userId: true } } },
			}),
		])

	// Earliest occurrence of each activity per person. One Map of Maps, built from rows already tagged with their kind, so a kind needs no second pass.
	const earliest = (rows: { userId: string; at: Date; key: ActivityKey }[]) => {
		const byUser = new Map<string, Map<ActivityKey, Date>>()
		for (const { userId, at, key } of rows) {
			let seen = byUser.get(userId)
			if (!seen) {
				seen = new Map<ActivityKey, Date>()
				byUser.set(userId, seen)
			}
			const held = seen.get(key)
			if (!held || at < held) seen.set(key, at)
		}
		return byUser
	}

	const activity = earliest([
		...devlogs.map((s) => ({ userId: s.themeProject.userId, at: s.createdAt, key: "devlog" as const })),
		...reels.map((p) => ({ userId: p.userId, at: p.publishedAt ?? p.createdAt, key: "reel" as const })),
		...repoLinks.map((p) => ({ userId: p.userId, at: p.createdAt, key: "repo" as const })),
		...hackatimeLinks.map((l) => ({ userId: l.themeProject.userId, at: l.createdAt, key: "hackatime" as const })),
		...timelapses.map((t) => ({
			userId: t.workSession.themeProject.userId,
			at: t.createdAt,
			key: "timelapse" as const,
		})),
	])

	const described = new Set(
		projects
			.filter((p) => (p.description !== null && p.description !== "") || p.starterProjectId !== null)
			.map((p) => p.userId),
	)

	// The journey stages before the branches. Read the same way the funnel reads them, so the two views line up on the path: a step is reached when the onboarding state machine is at or past it, and each accepts the branch that skips it (a starter pick jumps the project and idea questions) so nobody is drawn as having missed a step they were never asked.
	const loggedIn = new Set(sessions.map((s) => s.userId))
	const tookStarter = new Set(projects.filter((p) => p.starterProjectId !== null).map((p) => p.userId))
	const pickedTier = new Set(projects.filter((p) => p.requestedTier !== null).map((p) => p.userId))
	const ONBOARDING = {
		week: stepIndexOf("week"),
		idea: stepIndexOf("idea"),
		tracking: stepIndexOf("tracking"),
		repo: stepIndexOf("repo"),
	} as const

	// Each person's most recent decided or open hand-in, which is the one the outcome column should name.
	const outcomeNode = new Map<string, (typeof SANKEY_OUTCOME)[number]["node"]>()
	const OPEN = Number.NEGATIVE_INFINITY
	const handIns = new Map<string, { at: number; node: (typeof SANKEY_OUTCOME)[number]["node"] }>()
	for (const row of submissions) {
		const at = row.resolvedAt?.getTime() ?? OPEN
		const node = !row.resolvedResult
			? "awaiting"
			: row.resolvedResult === ReviewResult.APPROVED
				? "approved"
				: row.resolvedResult === ReviewResult.RETURNED
					? "returned"
					: "rejected"
		const held = handIns.get(row.themeProject.userId)
		if (!held || at > held.at) handIns.set(row.themeProject.userId, { at, node })
	}
	for (const [userId, handIn] of handIns) outcomeNode.set(userId, handIn.node)

	/** The person's first two tracked activities, oldest first, as box ids. A tuple, so both slots are always present. */
	const rankedBoxes = (userId: string): [string | null, string | null] => {
		const order = (entry: [ActivityKey, Date]) =>
			entry[1].getTime() * SANKEY_ACTIVITY.length + SANKEY_ACTIVITY.findIndex((x) => x.key === entry[0])
		const seen = [...(activity.get(userId)?.entries() ?? [])]
			// Ties broken by the declared branch order, so the same person is always the same ribbon run to run.
			.sort((a, b) => order(a) - order(b))
			.slice(0, 2)
			.map(([key], i) => activityNode(i + 1, key))
		return [seen[0] ?? null, seen[1] ?? null]
	}

	/** The person's box at each stage, null where they never got there. */
	const boxesOf = (user: (typeof users)[number]): (string | null)[] => {
		const completed = user.onboardingCompletedAt !== null
		const started = user.hardwareExperience !== null || completed || user.firstProjectAt !== null
		const step = user.onboardingStep
		const reached = (n: number) => step >= n || completed
		const [first, second] = rankedBoxes(user.id)
		return [
			"joined",
			loggedIn.has(user.id) ? "loggedIn" : null,
			started ? "setupStarted" : null,
			reached(ONBOARDING.week) ? "reachedWeek" : null,
			described.has(user.id) || completed ? "namedProject" : null,
			reached(ONBOARDING.idea) || tookStarter.has(user.id) ? "reachedIdea" : null,
			pickedTier.has(user.id) || tookStarter.has(user.id) || completed ? "pickedTier" : null,
			reached(ONBOARDING.tracking) ? "reachedTracking" : null,
			reached(ONBOARDING.repo) ? "reachedRepo" : null,
			completed ? "setupDone" : null,
			user.firstProjectAt !== null ? "projectLive" : null,
			user.participantGoal !== null ? "goalSet" : null,
			first,
			second,
			user.firstChecksPassedAt !== null ? "checksPassed" : null,
			outcomeNode.has(user.id) ? "handedIn" : null,
			outcomeNode.get(user.id) ?? "neverHandedIn",
		]
	}

	const counts = new Map<string, number>()
	const linkCounts = new Map<string, number>()
	for (const user of users) {
		const boxes = boxesOf(user).filter((box): box is string => box !== null)
		for (const box of boxes) counts.set(box, (counts.get(box) ?? 0) + 1)
		for (const [from, to] of boxes.slice(1).map((box, i) => [boxes[i] as string, box] as const))
			linkCounts.set(`${from}\u0000${to}`, (linkCounts.get(`${from}\u0000${to}`) ?? 0) + 1)
	}

	const stages: SankeyStage[] = [
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
		{ label: "Project live", nodes: ["projectLive"] },
		{ label: "Set a goal", nodes: ["goalSet"] },
		{ label: "First activity", nodes: activityNodes(1) },
		{ label: "Second activity", nodes: activityNodes(2) },
		{ label: "Repo checks passed", nodes: ["checksPassed"] },
		{ label: "Handed in", nodes: ["handedIn"] },
		{ label: "Outcome", nodes: SANKEY_OUTCOME.map((o) => o.node) },
	]

	const labels: Record<string, string> = {
		joined: "Signed up",
		loggedIn: "Logged in",
		setupStarted: "Started onboarding",
		reachedWeek: "Reached the week step",
		namedProject: "Named a project",
		reachedIdea: "Reached the idea step",
		pickedTier: "Picked a tier",
		reachedTracking: "Reached tracking",
		reachedRepo: "Reached the repo step",
		setupDone: "Finished onboarding",
		projectLive: "Project row live",
		goalSet: "Set a goal",
		checksPassed: "Checks passed",
		handedIn: "Handed in for review",
		...Object.fromEntries(
			SANKEY_ACTIVITY.flatMap((a) => [activityNode(1, a.key), activityNode(2, a.key)].map((id) => [id, a.label])),
		),
		...Object.fromEntries(SANKEY_OUTCOME.map((o) => [o.node, o.label])),
	}

	// Only boxes someone actually reached are drawn: a branch nobody took is not a finding, and an empty box in the middle of the diagram reads as a bug.
	const nodes = stages.flatMap((stage) =>
		stage.nodes
			.map((id) => ({ id, label: labels[id] ?? id, value: counts.get(id) ?? 0 }))
			.filter((node) => node.value > 0),
	)
	const live = new Set(nodes.map((n) => n.id))

	return {
		stages,
		nodes,
		links: [...linkCounts]
			.map(([key, value]) => {
				const [source, target] = key.split("\u0000")
				return { source: source as string, target: target as string, value }
			})
			.filter((link) => live.has(link.source) && live.has(link.target)),
		total: users.length,
	}
}
