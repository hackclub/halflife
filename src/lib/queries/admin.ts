import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import {
	AuditAction,
	HoursSource,
	type PhaseStatus,
	type ShopFulfillmentMethod,
	ShopFulfillmentStage,
	ShopOrderStatus,
	type Theme,
	type ReportStatus,
} from "@/app/generated/prisma/enums"
import { getBalances } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
import { safeDecrypt } from "@/lib/pii"
import { getPrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"
import { shopOrderStaffSelect } from "@/lib/shop"

export async function listUsers(opts: { q?: string; cursor?: string; limit: number }) {
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
	const items = hasMore ? rows.slice(0, opts.limit) : rows
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
	 * Include rows nobody has started. Every theme's row is made at sign-up, so
	 * without this the list is five placeholders per participant.
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

export async function getUserDetail(userId: string) {
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
			// The user page lists the number, item, credit total and status only;
			// internal cost and encrypted columns are not part of VIEW_USERS.
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
		// Explicit select, not `include`: a whole-row response carries the
		// encrypted address/phone and `lastActorId` this API has no use for.
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
 * What the fulfilment sheet lists. Rejected orders were refunded and never
 * ship; cancelled ones stay, since one may already be on its way to HQ.
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
 * The country is the one on their HCA profile now, not at order time: it is
 * what the parcel will actually be addressed to. It is decrypted here and only
 * the plain country leaves this function — never the ciphertext.
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
			// The page's filter box takes free text, so an unrecognised action is
			// treated as no filter rather than a Prisma enum error; the API route
			// rejects it properly with a 400.
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
 * Awards to ship, newest qualification first. `encryptedAddress` is read only
 * to answer "is an address locked on file"; the ciphertext never leaves the
 * server.
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
 * Recent live comments, newest first. A comment on a soft-deleted post is not
 * shown — nobody can reach it to report it — but a hidden comment stays in
 * the list so staff can see it was handled.
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
 * The participant journey as a funnel. Each row counts people who ALSO did
 * every step above it, so a step never has more people than the one before it
 * and drop-off is never negative — whatever order things actually happened in.
 *
 * Steps with a named marker come from User (lib/analytics); "named a project"
 * and the repo/devlog steps are derived from their own tables; "repo checks
 * passed" is stamped by the preflight that gates submissions. The onboarding,
 * goal and upload steps in between are derived as noted below.
 *
 * A note on the steps added between "logged in" and "posted a reel": they rest
 * on columns and tables that did not exist for the whole life of the program
 * (the goal prompt shipped after the first reels; a desktop file-pick writes
 * no upload-handoff row). Each is therefore "did this OR already did something
 * later that presupposes it". Without the fallback, inserting a late marker
 * would silently shrink every step below it instead of showing a real drop.
 */
export async function getUserFlowFunnel(): Promise<FlowStep[]> {
	const [users, sessionUsers, namedUsers, devlogUsers, repoUsers, handoffRows] = await Promise.all([
		prisma.user.findMany({
			select: {
				id: true,
				hardwareExperience: true,
				onboardingCompletedAt: true,
				participantGoal: true,
				firstProjectAt: true,
				firstReelAt: true,
				firstChecksPassedAt: true,
				firstSubmissionAt: true,
			},
		}),
		// People who logged in: a sign-in is what issues a session. Derived from
		// the table rather than the lastLoginAt marker, so the funnel does not
		// depend on the analytics backfill having run.
		prisma.session.findMany({ select: { userId: true }, distinct: ["userId"] }),
		// People who named a project: a live project carrying a description. The
		// row itself appears as soon as the checkpoint is opened and is already
		// titled with its theme, so a title says nothing — the description does.
		prisma.themeProject.findMany({
			where: { deletedAt: null, description: { not: null }, NOT: { description: "" } },
			select: { userId: true },
			distinct: ["userId"],
		}),
		// People who added a devlog: a project with a real work session on it.
		prisma.user.findMany({
			where: {
				themeProjects: {
					some: {
						deletedAt: null,
						workSessions: { some: { deletedAt: null, hoursSource: { not: HoursSource.HACKATIME_TRACKED } } },
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
		// Reel uploads. A row is written when the desktop mints a phone handoff;
		// `usedAt` means the phone actually sent a file. A desktop file-pick goes
		// straight to /api/upload and leaves no row here, which is why anyone who
		// posted is counted as having started and finished an upload.
		prisma.uploadHandoff.findMany({ select: { userId: true, usedAt: true } }),
	])

	const sessions = new Set(sessionUsers.map((s) => s.userId))
	const named = new Set(namedUsers.map((u) => u.userId))
	const devlogs = new Set(devlogUsers.map((u) => u.id))
	const repos = new Set(repoUsers.map((u) => u.userId))
	const handoffs = new Set(handoffRows.map((h) => h.userId))
	const handoffUploads = new Set(handoffRows.filter((h) => h.usedAt !== null).map((h) => h.userId))

	// One boolean per step per person, in funnel order; steps[0] (signup) is true
	// for everyone. The `|| posted` / `|| submitted` fallbacks are the history
	// guard described above the function — do not drop them.
	const flags = users.map((u) => {
		const posted = u.firstReelAt !== null
		const submitted = u.firstSubmissionAt !== null
		return [
			true,
			sessions.has(u.id),
			u.hardwareExperience !== null || u.onboardingCompletedAt !== null || u.firstProjectAt !== null,
			named.has(u.id) || u.firstProjectAt !== null,
			u.firstProjectAt !== null,
			u.onboardingCompletedAt !== null || posted || submitted,
			u.participantGoal !== null || posted || submitted,
			handoffs.has(u.id) || posted,
			handoffUploads.has(u.id) || posted,
			posted,
			devlogs.has(u.id),
			repos.has(u.id),
			u.firstChecksPassedAt !== null,
			submitted,
		]
	})
	const total = users.length

	const defs = [
		{ id: "signedUp", label: "Signed up", hint: "Account in the database" },
		{ id: "loggedIn", label: "Logged in", hint: "At least one sign-in" },
		{ id: "startedOnboarding", label: "Started onboarding", hint: "Answered the first getting-started question" },
		{ id: "namedProject", label: "Named a project", hint: "Gave a project a title and description" },
		{ id: "createdProject", label: "Created a project", hint: "Named a project and picked a funding tier" },
		{ id: "finishedOnboarding", label: "Finished onboarding", hint: "Worked through every getting-started step" },
		{ id: "setGoal", label: "Set a goal", hint: "Answered what they are here for" },
		{ id: "startedUpload", label: "Started a reel upload", hint: "Opened the recorder or minted a phone code" },
		{ id: "uploadedReel", label: "Uploaded a reel", hint: "A video reached the bucket, posted or not" },
		{ id: "postedReel", label: "Posted a reel", hint: "A video published to the feed" },
		{ id: "addedDevlog", label: "Added a devlog", hint: "Wrote a journal entry" },
		{ id: "connectedRepo", label: "Connected a repo", hint: "Linked an external repository to a project" },
		{ id: "checksPassed", label: "Repo checks passed", hint: "Every submission repo check came back green" },
		{ id: "submitted", label: "Submitted a project", hint: "Handed a phase in for review" },
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
 * The moderation queue for user reports: who flagged what, why, and what
 * staff did about it. Newest first, with the reported row's own preview and
 * author alongside, so a report reads without opening five tabs.
 */
export async function listContentReports(status: ReportStatusFilter = "OPEN", limit = 100) {
	const rows = await prisma.contentReport.findMany({
		where: status === "ALL" ? undefined : { status },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: limit,
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
	return rows
}

export type ContentReportRow = Awaited<ReturnType<typeof listContentReports>>[number]

export async function countContentReports(): Promise<Record<ReportStatus, number>> {
	const groups = await prisma.contentReport.groupBy({ by: ["status"], _count: { _all: true } })
	const counts: Record<ReportStatus, number> = { OPEN: 0, RESOLVED: 0, DISMISSED: 0 }
	for (const group of groups) counts[group.status] = group._count._all
	return counts
}
