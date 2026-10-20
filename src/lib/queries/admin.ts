import "server-only"
import type { AuditLog, LedgerEntry, Prisma } from "@/app/generated/prisma/client"
import {
	AuditAction,
	HoursSource,
	type ParticipantGoal,
	Phase,
	PhaseStatus,
	PostKind,
	type ReportStatus,
	ReviewPass,
	ReviewResult,
	type Role,
	type ShopFulfillmentMethod,
	ShopFulfillmentStage,
	ShopOrderStatus,
	Theme,
} from "@/app/generated/prisma/enums"
import { isActiveDay } from "@/lib/analytics"
import { GOAL_OPTIONS } from "@/lib/config/goal"
import { getStarterProject, STARTER_PROJECT_TIER, stepIndexOf } from "@/lib/config/onboarding"
import { getThemeDef, scheduleForWeek, TOTAL_WEEKS, WARMUP_THEME, WARMUP_WEEK_ID } from "@/lib/config/program"
import { isTierId, TIERS } from "@/lib/config/tiers"
import { type Balances, getBalances } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
import { type LinkRow, rollUpHours, type SessionRow } from "@/lib/hours"
import { type RecordedWindow, timelapseWindow } from "@/lib/hours-overlap"
import { pctOf, round1 } from "@/lib/numbers"
import { type CursorOrderOf, cursorWhere, orderByFor, pageResult, positionWhere, readCursor } from "@/lib/pagination"
import { safeDecrypt } from "@/lib/pii"
import { getPrinterQualification, type PrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings, startOfDay } from "@/lib/program"
import { countryOfTimezone, REGIONS, type RegionId, regionOfTimezone } from "@/lib/regions"
import { shopOrderStaffSelect } from "@/lib/shop"

/** One row of the admin user directory, with contact and risk fields blanked unless the caller may see PII. */
export interface DirectoryUser {
	createdAt: Date
	displayName: string | null
	email: string
	fraudFlagged: boolean
	id: string
	name: string | null
	roles: { role: Role }[]
	slackId: string | null
	verificationStatus: string | null
}

/**
 * The directory's order: newest first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops an account or hands one out twice.
 */
const USERS_ORDER = {
	at: (row: DirectoryUser) => row.createdAt,
	column: "createdAt",
	direction: "desc",
} as const satisfies CursorOrderOf<DirectoryUser, Prisma.UserOrderByWithRelationInput>

export async function listUsers(
	opts: { q?: string; cursor?: string; limit: number },
	flags?: { includePii?: boolean },
): Promise<{ items: DirectoryUser[]; nextCursor: string | null }> {
	const includePii = flags?.includePii ?? false
	// Without PII the search box matches names only. Matching an address or a Slack id would turn the directory into a registration oracle: anybody holding VIEW_USERS could confirm whether a given person has an account here.
	//
	// The search sits inside an AND array rather than at the top level. The cursor's own filter is a top-level OR, and two ORs in one where cancel each other out rather than both applying: a page of search results that ignored the search would be a worse answer than no page at all.
	const base: Prisma.UserWhereInput = opts.q
		? {
				AND: [
					{
						OR: [
							{ name: { contains: opts.q, mode: "insensitive" } },
							{ displayName: { contains: opts.q, mode: "insensitive" } },
							...(includePii
								? ([
										{ email: { contains: opts.q, mode: "insensitive" } },
										{ slackId: { contains: opts.q, mode: "insensitive" } },
									] satisfies Prisma.UserWhereInput[])
								: []),
						],
					},
				],
			}
		: {}
	const rows = await prisma.user.findMany({
		orderBy: orderByFor(USERS_ORDER),
		select: {
			createdAt: true,
			displayName: true,
			email: true,
			fraudFlagged: true,
			id: true,
			name: true,
			roles: { select: { role: true } },
			slackId: true,
			verificationStatus: true,
		},
		take: opts.limit + 1,
		// The directory is rendered as a page as well as served as an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
		where: positionWhere<Prisma.UserWhereInput>(readCursor(opts.cursor), USERS_ORDER, base),
	})
	const page = pageResult(rows, opts.limit, USERS_ORDER)
	// Contact + risk fields only leave the server for ADMIN/AUDITOR. REVIEWER/FULFILLER get the directory (names + roles) with no emails, Slack ids or fraud flags to scrape. Callers pass includePii explicitly; the default is stripped.
	const items = page.items.map(row =>
		includePii
			? row
			: Object.assign({}, row, { email: "", fraudFlagged: false, slackId: null, verificationStatus: null }),
	)
	return { items, nextCursor: page.nextCursor }
}

export interface ProjectFilters {
	buildStatus?: PhaseStatus
	designStatus?: PhaseStatus
	/** Only projects, or owners, with an extension still running. */
	extended?: boolean
	/** Matches the project's title, description or repo, or its owner's name. The owner's email and Slack ID are matched too, but only for a caller who may see PII. */
	q?: string
	theme?: Theme
	tier?: number
	/**
	 * Include rows nobody has started. Every theme's row is made at sign-up, so without this the list is five placeholders per participant.
	 */
	unstarted?: boolean
}

/** One row of the admin project directory, with its owner's directory fields. */
export type ProjectDirectoryRow = Prisma.ThemeProjectGetPayload<{ select: typeof projectDirectorySelect }>

const projectDirectorySelect = {
	buildStatus: true,
	designStatus: true,
	githubRepo: true,
	id: true,
	requestedTier: true,
	submissionExtensionUntil: true,
	theme: true,
	tier: true,
	title: true,
	updatedAt: true,
	user: {
		select: {
			displayName: true,
			email: true,
			id: true,
			name: true,
			slackId: true,
			submissionExtensionUntil: true,
		},
	},
} satisfies Prisma.ThemeProjectSelect

/**
 * The project directory's order: most recently touched first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops a project or hands one out twice.
 */
const PROJECTS_ORDER = {
	at: (row: ProjectDirectoryRow) => row.updatedAt,
	column: "updatedAt",
	direction: "desc",
} as const satisfies CursorOrderOf<ProjectDirectoryRow, Prisma.ThemeProjectOrderByWithRelationInput>

export async function listProjects(
	opts: ProjectFilters & { cursor?: string; limit: number },
	flags?: { includePii?: boolean },
): Promise<{ items: ProjectDirectoryRow[]; nextCursor: string | null }> {
	const includePii = flags?.includePii ?? false
	const now = new Date()
	const q = opts.q?.trim()
	// The owner's email and Slack id are contact details, so they are matched only for a caller who may see them. A REVIEWER searching for an address gets the same answer whether or not it is registered here.
	//
	// Every filter that is itself an OR lives in the AND array, never at the top level: the cursor's own filter is a top-level OR, and two ORs in one where cancel each other out rather than both applying.
	const where: Prisma.ThemeProjectWhereInput = {
		deletedAt: null,
		...(opts.unstarted ? {} : { namedAt: { not: null } }),
		...(opts.theme ? { theme: opts.theme } : {}),
		...(opts.designStatus ? { designStatus: opts.designStatus } : {}),
		...(opts.buildStatus ? { buildStatus: opts.buildStatus } : {}),
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
							...(includePii
								? ([
										{ user: { email: { contains: q, mode: "insensitive" } } },
										{ user: { slackId: { contains: q, mode: "insensitive" } } },
									] satisfies Prisma.ThemeProjectWhereInput[])
								: []),
						],
					}
				: {},
			opts.extended
				? {
						OR: [{ submissionExtensionUntil: { gt: now } }, { user: { submissionExtensionUntil: { gt: now } } }],
					}
				: {},
			opts.tier ? { OR: [{ tier: opts.tier }, { requestedTier: opts.tier, tier: null }] } : {},
		],
	}

	const rows = await prisma.themeProject.findMany({
		orderBy: orderByFor(PROJECTS_ORDER),
		select: projectDirectorySelect,
		take: opts.limit + 1,
		// The directory is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
		where: positionWhere<Prisma.ThemeProjectWhereInput>(readCursor(opts.cursor), PROJECTS_ORDER, where),
	})
	const page = pageResult(rows, opts.limit, PROJECTS_ORDER)
	// The same rule as the user directory: the owner's contact details leave the server for ADMIN/AUDITOR only. A REVIEWER/FULFILLER gets names and roles, with no email or Slack id to scrape.
	const items = page.items.map(row =>
		includePii ? row : Object.assign({}, row, { user: Object.assign({}, row.user, { email: "", slackId: null }) }),
	)
	return { items, nextCursor: page.nextCursor }
}

const userDetailSelect = {
	createdAt: true,
	displayName: true,
	email: true,
	fraudFlagged: true,
	hackatimeUserId: true,
	id: true,
	joinedProgramAt: true,
	name: true,
	// The award's fulfilment fields only. The locked address and phone are ciphertext and the snapshot is write-only, so none of them are part of a profile that anybody with VIEW_USERS may read.
	printerAward: {
		select: {
			addressLockedAt: true,
			deliveredAt: true,
			id: true,
			qualifiedAt: true,
			revokedAt: true,
			revokedReason: true,
			shippedAt: true,
			status: true,
			trackingCarrier: true,
			trackingNumber: true,
		},
	},
	roles: { select: { grantedAt: true, grantedBy: true, role: true } },
	slackDisplayName: true,
	slackId: true,
	submissionExtensionUntil: true,
	themeProjects: {
		select: {
			approvedHours: true,
			buildCoins: true,
			buildStatus: true,
			designBankedCoins: true,
			designSpendableCoins: true,
			designStatus: true,
			grantUsd: true,
			hcbGrantTopUps: { select: { id: true }, where: { phase: "DESIGN", sentAt: { not: null } } },
			id: true,
			submissionExtensionUntil: true,
			theme: true,
			tier: true,
			title: true,
		},
		where: { deletedAt: null },
	},
	verificationStatus: true,
} satisfies Prisma.UserSelect

/** The admin user profile: the selected columns plus money sections both branches fill. */
export type UserDetail = Prisma.UserGetPayload<{ select: typeof userDetailSelect }>

const userDetailOrderSelect = {
	id: true,
	itemNameSnapshot: true,
	orderNumber: true,
	status: true,
	totalCredits: true,
} satisfies Prisma.ShopOrderSelect

/** The 25 most recent orders on the user page: number, item, credit total and status only. */
export type UserDetailOrder = Prisma.ShopOrderGetPayload<{ select: typeof userDetailOrderSelect }>

export async function getUserDetail(
	userId: string,
	flags?: { includeSensitive?: boolean },
): Promise<{
	user: UserDetail
	balances: Balances
	ledger: LedgerEntry[]
	orders: UserDetailOrder[]
	printer: PrinterQualification
} | null> {
	const includeSensitive = flags?.includeSensitive ?? false
	const user = await prisma.user.findUnique({
		select: userDetailSelect,
		where: { id: userId },
	})
	if (!user) return null

	// Ledger, balances and order history only leave the server for ADMIN/AUDITOR – a FULFILLER (shipping role) needs the fulfilment sheet, not someone's full credit history. Stripped callers get the profile with contact/risk fields redacted and empty money sections.
	if (!includeSensitive) {
		const printer = await getPrinterQualification(userId)
		return {
			balances: { banked: 0, spendable: 0, total: 0 },
			ledger: [],
			orders: [],
			printer,
			user: {
				...user,
				email: "",
				fraudFlagged: false,
				hackatimeUserId: null,
				slackDisplayName: null,
				slackId: null,
				verificationStatus: null,
			},
		}
	}

	const [balances, ledger, orders, printer] = await Promise.all([
		prisma.$transaction(tx => getBalances(tx, userId)),
		prisma.ledgerEntry.findMany({
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: 50,
			where: { userId },
		}),
		prisma.shopOrder.findMany({
			orderBy: { placedAt: "desc" },
			// The user page lists the number, item, credit total and status only; internal cost and encrypted columns are not part of VIEW_USERS.
			select: userDetailOrderSelect,
			take: 25,
			where: { userId },
		}),
		getPrinterQualification(userId),
	])

	return { balances, ledger, orders, printer, user }
}

/** One row of the admin order directory: the staff-safe columns plus buyer and item names. */
export type OrderDirectoryRow = Prisma.ShopOrderGetPayload<{ select: typeof orderDirectorySelect }>

const orderDirectorySelect = {
	...shopOrderStaffSelect,
	shopItem: { select: { id: true, name: true } },
	user: { select: { displayName: true, id: true, name: true } },
} satisfies Prisma.ShopOrderSelect

/**
 * The order directory's order: newest first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops an order or hands one out twice.
 */
const ORDERS_ORDER = {
	at: (row: OrderDirectoryRow) => row.placedAt,
	column: "placedAt",
	direction: "desc",
} as const satisfies CursorOrderOf<OrderDirectoryRow, Prisma.ShopOrderOrderByWithRelationInput>

export async function listOrders(opts: {
	status?: ShopOrderStatus
	cursor?: string
	limit: number
}): Promise<{ items: OrderDirectoryRow[]; nextCursor: string | null }> {
	const rows = await prisma.shopOrder.findMany({
		orderBy: orderByFor(ORDERS_ORDER),
		// Explicit select, not `include`: a whole-row response carries the encrypted address/phone and `lastActorId` this API has no use for.
		select: orderDirectorySelect,
		take: opts.limit + 1,
		// Only the API reads this list, so a cursor that is not one of ours is a bad request rather than a page to fall back to.
		where: cursorWhere<Prisma.ShopOrderWhereInput>(
			opts.cursor,
			ORDERS_ORDER,
			opts.status ? { status: opts.status } : {},
		),
	})
	return pageResult(rows, opts.limit, ORDERS_ORDER)
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
	/** `"NONE"` is an order nobody has chosen a method for yet. */
	method?: ShopFulfillmentMethod | "NONE"
	/** Exclusive. */
	placedBefore?: Date
	/** Inclusive, from the start of this instant. */
	placedFrom?: Date
	stage?: ShopFulfillmentStage
}

/**
 * Orders for the fulfilment sheet, with each buyer's country.
 *
 * The country is the one on their HCA profile now, not at order time: it is what the parcel will actually be addressed to. It is decrypted here and only the plain country leaves this function – never the ciphertext.
 */
/** One row of the fulfilment sheet: the order with its resolved stage, dollar total and buyer. */
export interface FulfillmentOrderRow {
	country: string | null
	fulfillmentMethod: ShopFulfillmentMethod | null
	fulfillmentStage: ShopFulfillmentStage
	id: string
	itemNameSnapshot: string
	orderNumber: number
	placedAt: Date
	quantity: number
	status: ShopOrderStatus
	totalUsd: number | null
	user: { id: string; name: string | null }
}

/** The columns the fulfilment sheet reads, and the order they are read in. */
const fulfillmentOrderSelect = {
	fulfillmentMethod: true,
	fulfillmentStage: true,
	id: true,
	itemNameSnapshot: true,
	orderNumber: true,
	placedAt: true,
	quantity: true,
	shopItem: { select: { costUsd: true } },
	status: true,
	unitCostUsd: true,
	user: {
		select: { displayName: true, encryptedAddressCountry: true, id: true, name: true },
	},
} satisfies Prisma.ShopOrderSelect

/** One row as it comes out of the database, before the sheet's own arithmetic. */
type FulfillmentOrderModel = Prisma.ShopOrderGetPayload<{ select: typeof fulfillmentOrderSelect }>

/**
 * The fulfilment sheet's order: newest first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops an order or hands one out twice.
 */
const FULFILLMENT_ORDERS_ORDER = {
	at: (row: FulfillmentOrderModel) => row.placedAt,
	column: "placedAt",
	direction: "desc",
} as const satisfies CursorOrderOf<FulfillmentOrderModel, Prisma.ShopOrderOrderByWithRelationInput>

export async function listFulfillmentOrders(
	filters: FulfillmentFilters,
	opts: { cursor?: string; limit: number },
): Promise<{ items: FulfillmentOrderRow[]; nextCursor: string | null }> {
	// The stage filter lives in the AND array rather than at the top level: the cursor's own filter is a top-level OR, and two ORs in one where cancel each other out rather than both applying.
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
		...(filters.stage
			? {
					AND: [
						filters.stage === ShopFulfillmentStage.CANCELLED
							? {
									OR: [{ status: ShopOrderStatus.CANCELLED }, { fulfillmentStage: ShopFulfillmentStage.CANCELLED }],
								}
							: {
									// A cancelled order shows as cancelled, so it matches no other stage.
									fulfillmentStage: filters.stage,
									status: { not: ShopOrderStatus.CANCELLED },
								},
					],
				}
			: {}),
	}

	const rows = await prisma.shopOrder.findMany({
		orderBy: orderByFor(FULFILLMENT_ORDERS_ORDER),
		select: fulfillmentOrderSelect,
		take: opts.limit + 1,
		// The sheet is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
		where: positionWhere<Prisma.ShopOrderWhereInput>(readCursor(opts.cursor), FULFILLMENT_ORDERS_ORDER, where),
	})
	const page = pageResult(rows, opts.limit, FULFILLMENT_ORDERS_ORDER)

	const items = page.items.map(({ shopItem, user, unitCostUsd, ...order }) => {
		// Orders from before the item had a cost fall back to today's.
		const unit = unitCostUsd ?? shopItem.costUsd
		return Object.assign(order, {
			country: safeDecrypt(user.encryptedAddressCountry),
			fulfillmentStage: fulfillmentStageOf(order),
			totalUsd: unit === null ? null : unit * order.quantity,
			user: { id: user.id, name: displayName(user) },
		})
	})
	return { items, nextCursor: page.nextCursor }
}

/** True for one of the recorded action names. Guards the audit-log filter. */
export function isAuditAction(value: string): value is AuditAction {
	return (Object.values(AuditAction) as string[]).includes(value)
}

/**
 * The audit log's order: newest first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops an entry or hands one out twice.
 */
const AUDIT_LOG_ORDER = {
	at: (row: AuditLog) => row.createdAt,
	column: "createdAt",
	direction: "desc",
} as const satisfies CursorOrderOf<AuditLog, Prisma.AuditLogOrderByWithRelationInput>

export async function listAuditLog(opts: {
	action?: string
	targetId?: string
	cursor?: string
	limit: number
}): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
	const base: Prisma.AuditLogWhereInput = {
		// The page's filter box takes free text, so an unrecognised action is treated as no filter rather than a Prisma enum error; the API route rejects it properly with a 400.
		...(opts.action && isAuditAction(opts.action) ? { action: opts.action } : {}),
		...(opts.targetId ? { targetId: opts.targetId } : {}),
	}
	const rows = await prisma.auditLog.findMany({
		orderBy: orderByFor(AUDIT_LOG_ORDER),
		take: opts.limit + 1,
		// The log is rendered as a page as well as served as an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
		where: positionWhere<Prisma.AuditLogWhereInput>(readCursor(opts.cursor), AUDIT_LOG_ORDER, base),
	})
	return pageResult(rows, opts.limit, AUDIT_LOG_ORDER)
}

/**
 * Awards to ship, newest qualification first. `encryptedAddress` is read only to answer "is an address locked on file"; the ciphertext never leaves the server.
 */
/** Printer awards with the ciphertext folded into an on-file flag. */
export interface PrinterAwardRow
	extends Omit<Prisma.PrinterAwardGetPayload<{ select: typeof printerAwardSelect }>, "encryptedAddress"> {
	addressOnFile: boolean
}

const printerAwardSelect = {
	addressLockedAt: true,
	deliveredAt: true,
	encryptedAddress: true,
	id: true,
	qualifiedAt: true,
	revokedAt: true,
	revokedReason: true,
	shippedAt: true,
	status: true,
	trackingCarrier: true,
	trackingNumber: true,
	user: { select: { displayName: true, id: true, name: true } },
} satisfies Prisma.PrinterAwardSelect

export async function listPrinterAwards(limit = 100): Promise<PrinterAwardRow[]> {
	const rows = await prisma.printerAward.findMany({
		orderBy: [{ qualifiedAt: "desc" }],
		select: printerAwardSelect,
		take: limit,
	})
	return rows.map(({ encryptedAddress, ...award }) => Object.assign(award, { addressOnFile: encryptedAddress !== "" }))
}

/** Recent live reels, newest first, for the moderation panel. */
/** One row of the listRecentPostsForModeration list. */
export type ModeratedPost = Prisma.PostGetPayload<{ select: typeof moderatedPostSelect }>

const moderatedPostSelect = {
	caption: true,
	createdAt: true,
	hiddenAt: true,
	hiddenReason: true,
	id: true,
	kind: true,
	publishedAt: true,
	themeProject: { select: { id: true, title: true } },
	user: { select: { displayName: true, email: true, id: true, name: true } },
} satisfies Prisma.PostSelect

export function listRecentPostsForModeration(limit = 25): Promise<ModeratedPost[]> {
	return prisma.post.findMany({
		orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
		select: moderatedPostSelect,
		take: limit,
		where: { deletedAt: null },
	})
}

/**
 * Recent live comments, newest first. A comment on a soft-deleted post is not shown – nobody can reach it to report it – but a hidden comment stays in the list so staff can see it was handled.
 */
/** One row of the listRecentCommentsForModeration list. */
export type ModeratedComment = Prisma.PostCommentGetPayload<{ select: typeof moderatedCommentSelect }>

const moderatedCommentSelect = {
	body: true,
	createdAt: true,
	hiddenAt: true,
	hiddenReason: true,
	id: true,
	post: { select: { caption: true, id: true } },
	user: { select: { displayName: true, email: true, id: true, name: true } },
} satisfies Prisma.PostCommentSelect

export function listRecentCommentsForModeration(limit = 25): Promise<ModeratedComment[]> {
	return prisma.postComment.findMany({
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		select: moderatedCommentSelect,
		take: limit,
		where: { deletedAt: null, post: { deletedAt: null } },
	})
}

/** Public reel links, newest first, so staff can find a post that went viral. */
/** One row of the public-reel directory. */
export type PublicReelRow = Prisma.PublicReelGetPayload<{ select: typeof publicReelSelect }>

const publicReelSelect = {
	email: true,
	id: true,
	platform: true,
	post: { select: { caption: true, id: true } },
	postedAt: true,
	themeProject: { select: { id: true, title: true } },
	url: true,
	user: { select: { displayName: true, id: true, name: true } },
} satisfies Prisma.PublicReelSelect

export function listRecentPublicReels(limit = 100): Promise<PublicReelRow[]> {
	return prisma.publicReel.findMany({
		orderBy: [{ postedAt: "desc" }, { id: "desc" }],
		select: publicReelSelect,
		take: limit,
	})
}

export async function getAdminCounters(): Promise<{
	pendingReviews: number
	pendingReviewsUnsent: number
	pendingOrders: number
	participants: number
	shipped: number
}> {
	// A live hand-in: an open submission on a phase that is actually in review, on a project that still exists. The phase check matters on its own – counting every unresolved row also sweeps up submissions whose phase has moved on without the row resolving.
	const liveHandIn: Prisma.PhaseSubmissionWhereInput = {
		OR: [
			{ phase: Phase.DESIGN, themeProject: { designStatus: PhaseStatus.in_review } },
			{ phase: Phase.BUILD, themeProject: { buildStatus: PhaseStatus.in_review } },
		],
		resolvedAt: null,
		themeProject: { deletedAt: null },
	}

	const [pendingReviews, pendingReviewsUnsent, pendingOrders, participants, shipped] = await Promise.all([
		// Sent, and Ari holds it. This is the number that answers "how much is in the review queue", and the only one comparable to Ari's own pending count.
		//
		// `ariSubmissionId` is the marker rather than `ariStatus`, which only a decision or a reset ever writes and so says nothing about a ship nobody has opened yet.
		prisma.phaseSubmission.count({ where: { ...liveHandIn, ariSubmissionId: { not: null } } }),
		// Never reached Ari: the send failed and the retry has not got it through yet. Counted apart because folding it in is how this panel's "awaiting review" drifted hundreds above the queue reviewers actually had – a hand-in Ari has never seen is not waiting for review, it is waiting for us.
		prisma.phaseSubmission.count({ where: { ...liveHandIn, ariSubmissionId: null } }),
		prisma.shopOrder.count({ where: { status: ShopOrderStatus.PENDING } }),
		prisma.user.count(),
		prisma.printerAward.count({ where: { revokedAt: null } }),
	])
	return { participants, pendingOrders, pendingReviews, pendingReviewsUnsent, shipped }
}

export interface FlowStep {
	count: number
	/** Share of the previous step that stopped here. */
	dropOffPct: number
	hint: string
	id: string
	label: string
	/** Share of everyone who signed up that got this far. */
	ofSignupsPct: number
	/** Share of the previous step that made it down to this one. */
	retainPct: number
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
 * The tracked-time rows that used to end this funnel ("Hackatimed", "Lapsed", "Devlogged") are gone, and two queries with them. Counted on a cumulative spine they asked a question the spine cannot answer: "of the people who got this far, how many have a Hackatime link" reads a maker who journals competently and never links Hackatime as a drop-off, when they did not drop out of anything – they took a different route through the same week. Activity is a set of branches rather than rungs, and branches are what the Sankey view draws: there they sit in one activity stage as ribbons of whatever width they really are, in any order, which is the only shape that can show a maker who both journalled and linked Hackatime. One fact, drawn once, rather than drawn twice in two shapes that disagree.
 */
export async function getUserFlowFunnel(): Promise<FlowStep[]> {
	const [users, sessionUsers, projectUsers, devlogUsers, repoUsers] = await Promise.all([
		prisma.user.findMany({
			select: {
				firstChecksPassedAt: true,
				firstProjectAt: true,
				firstReelAt: true,
				firstSubmissionAt: true,
				hardwareExperience: true,
				id: true,
				onboardingCompletedAt: true,
				onboardingStep: true,
				participantGoal: true,
			},
		}),
		// People who logged in: a sign-in is what issues a session. Derived from the table rather than the lastLoginAt marker, so the funnel does not depend on the analytics backfill having run.
		prisma.session.findMany({ distinct: ["userId"], select: { userId: true } }),
		// The onboarding paper trail, per person, read off their live projects: a description means they named something, a starter means they took one of the catalogue's, and a requested tier means they answered the tier question. One read for all three because the funnel needs them together.
		prisma.themeProject.findMany({
			select: { description: true, requestedTier: true, starterProjectId: true, userId: true },
			where: { deletedAt: null },
		}),
		// People who added a devlog: a project with a real work session on it.
		prisma.user.findMany({
			select: { id: true },
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
		}),
		// People who connected a repository to a project.
		prisma.themeProject.findMany({
			distinct: ["userId"],
			select: { userId: true },
			where: {
				deletedAt: null,
				OR: [{ githubRepo: { not: null } }, { repoSyncRepo: { not: null } }, { repoSyncEnabled: true }],
			},
		}),
	])

	const sessions = new Set(sessionUsers.map(s => s.userId))
	const named = new Set(projectUsers.filter(p => p.description !== null && p.description !== "").map(p => p.userId))
	const tookStarter = new Set(projectUsers.filter(p => p.starterProjectId !== null).map(p => p.userId))
	const pickedTier = new Set(projectUsers.filter(p => p.requestedTier !== null).map(p => p.userId))
	const devlogs = new Set(devlogUsers.map(u => u.id))
	const repos = new Set(repoUsers.map(u => u.userId))

	// One boolean per step per person, in funnel order; steps[0] (signup) is true for everyone. The `|| posted` / `|| submitted` fallbacks are the history guard described above the function – do not drop them.
	//
	// The onboarding steps between "started" and "finished" are read from `onboardingStep` (the furthest step reached, 0-based) rather than from a marker per step, because that one column is the state machine's own answer and predates nothing. Each carries `|| completed` so a person who finished is never missing from an earlier row, and each also accepts the branch that skips it: a starter pick jumps the project and idea steps, so "named or picked" and "tier settled" are ORs, not a single column.
	const ONBOARDING = {
		idea: stepIndexOf("idea"),
		repo: stepIndexOf("repo"),
		tracking: stepIndexOf("tracking"),
		week: stepIndexOf("week"),
	} as const
	const flags = users.map(u => {
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
		]
	})
	const total = users.length

	const defs = [
		{ hint: "Account in the database", id: "signedUp", label: "Signed up" },
		{ hint: "At least one sign-in", id: "loggedIn", label: "Logged in" },
		{ hint: "Answered the first getting-started question", id: "startedOnboarding", label: "Started onboarding" },
		{ hint: "Saw what this week's theme is", id: "reachedWeek", label: "Reached the week step" },
		{
			hint: "Described a project, or took a starter",
			id: "namedProject",
			label: "Named or picked a project",
		},
		{ hint: "Passed the project step to the starter ideas", id: "reachedIdea", label: "Reached the idea step" },
		{ hint: "Answered the tier question, or took a starter", id: "pickedTier", label: "Picked a tier" },
		{ hint: "Saw how hours are logged", id: "reachedTracking", label: "Reached time tracking" },
		{ hint: "Saw the optional repo-linking question", id: "reachedRepo", label: "Reached the repo step" },
		{ hint: "Worked through every getting-started step", id: "finishedOnboarding", label: "Finished onboarding" },
		{ hint: "A project row with its first marker stamped", id: "createdProject", label: "Created a project" },
		{ hint: "Answered what they are here for", id: "setGoal", label: "Set a goal" },
		{ hint: "Logged a work session on a project", id: "addedDevlog", label: "Added a devlog" },
		{ hint: "Linked an external repository to a project", id: "connectedRepo", label: "Connected a repo" },
		{ hint: "Every submission repo check came back green", id: "checksPassed", label: "Repo checks passed" },
		{ hint: "Handed a phase in for review", id: "submitted", label: "Submitted a project" },
	] as const

	const steps: FlowStep[] = []
	for (const [n, def] of defs.entries()) {
		let count = 0
		for (const f of flags) {
			let ok = true
			for (let k = 0; k <= n; k += 1)
				if (!f[k]) {
					ok = false
					break
				}

			if (ok) count += 1
		}
		const prev = n === 0 ? total : (steps[n - 1]?.count ?? total)
		steps.push({
			...def,
			count,
			dropOffPct: n === 0 ? 0 : pctOf(prev - count, prev),
			ofSignupsPct: pctOf(count, total),
			retainPct: pctOf(count, prev),
		})
	}
	return steps
}

export type ReportStatusFilter = ReportStatus | "ALL"

/**
 * The moderation queue for user reports: who flagged what, why, and what staff did about it. Newest first, with the reported row's own preview and author alongside, so a report reads without opening five tabs. Cursor- paged like the audit log, so a busy queue never silently drops its tail.
 */
const contentReportSelect = {
	comment: {
		select: {
			body: true,
			deletedAt: true,
			hiddenAt: true,
			id: true,
			postId: true,
			user: { select: { displayName: true, id: true, name: true } },
		},
	},
	createdAt: true,
	details: true,
	id: true,
	post: {
		select: {
			caption: true,
			deletedAt: true,
			hiddenAt: true,
			id: true,
			user: { select: { displayName: true, id: true, name: true } },
		},
	},
	reason: true,
	reporter: { select: { displayName: true, email: true, id: true, name: true } },
	resolvedAt: true,
	resolvedById: true,
	status: true,
	target: true,
	targetUser: { select: { displayName: true, id: true, name: true } },
	themeProject: {
		select: {
			deletedAt: true,
			id: true,
			title: true,
			user: { select: { displayName: true, id: true, name: true } },
		},
	},
	workSession: {
		select: {
			content: true,
			deletedAt: true,
			id: true,
			themeProject: {
				select: {
					id: true,
					title: true,
					user: { select: { displayName: true, id: true, name: true } },
				},
			},
			title: true,
		},
	},
} satisfies Prisma.ContentReportSelect

/** One row of the content-report directory, with every reportable target attached. */
export type ContentReportRow = Prisma.ContentReportGetPayload<{ select: typeof contentReportSelect }>

/**
 * The reports' order: newest first, with the id as the tiebreaker.
 *
 * The cursor carries both halves of that position, so a page boundary never drops a report or hands one out twice.
 */
const CONTENT_REPORTS_ORDER = {
	at: (row: ContentReportRow) => row.createdAt,
	column: "createdAt",
	direction: "desc",
} as const satisfies CursorOrderOf<ContentReportRow, Prisma.ContentReportOrderByWithRelationInput>

export async function listContentReports(
	status: ReportStatusFilter = "OPEN",
	opts: { cursor?: string; limit?: number } = {},
): Promise<{ items: ContentReportRow[]; nextCursor: string | null }> {
	const limit = opts.limit ?? 50
	const rows = await prisma.contentReport.findMany({
		orderBy: orderByFor(CONTENT_REPORTS_ORDER),
		select: contentReportSelect,
		take: limit + 1,
		// The queue is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
		where: positionWhere<Prisma.ContentReportWhereInput>(
			readCursor(opts.cursor),
			CONTENT_REPORTS_ORDER,
			status === "ALL" ? {} : { status },
		),
	})
	return pageResult(rows, limit, CONTENT_REPORTS_ORDER)
}

export async function countContentReports(): Promise<Record<ReportStatus, number>> {
	const groups = await prisma.contentReport.groupBy({ _count: { _all: true }, by: ["status"] })
	const counts: Record<ReportStatus, number> = { DISMISSED: 0, OPEN: 0, RESOLVED: 0 }
	for (const group of groups) counts[group.status] = group._count._all
	return counts
}

export interface AreaStat {
	/**
	 * Hours logged by those accounts: journal sessions (reviewer-adjusted where set) plus linked Hackatime time, with a sitting that was both journalled and tracked counted once rather than twice. A HACKATIME_TRACKED session contributes nothing on its own, exactly as the ledger reads it.
	 */
	hours: number
	id: RegionId
	label: string
	/** Accounts whose timezone maps here. */
	users: number
}

export interface CountryStat {
	country: string
	/** Hours logged by those accounts, as above. */
	hours: number
	/** Accounts whose timezone maps here. */
	users: number
}

/**
 * Users and hours per region, for the overview's geography section.
 *
 * Regions come from each account's timezone – the only per-user geography with real coverage (see lib/regions). Hours are attributed to the author's region, never to a project's.
 *
 * `timelapses` and `cachedSpans` are selected even though this file is a report rather than a ledger, because `rollUpHours` is what decides whether a sitting is counted once or twice and it can only answer from those two. Reading the cache without them is how this panel came to report the same hours twice: the seconds were fresh and the spans were never asked for, so there was nothing to subtract against.
 */
async function loadRegionInputs() {
	const [users, sessions, links] = await Promise.all([
		prisma.user.findMany({ select: { id: true, timezone: true } }),
		prisma.workSession.findMany({
			select: {
				hoursApproved: true,
				hoursClaimed: true,
				hoursSource: true,
				phase: true,
				themeProject: { select: { userId: true } },
				themeProjectId: true,
				timelapses: { select: { coveredSeconds: true, hackatimeProject: true, recordedAt: true } },
			},
			where: { deletedAt: null, themeProject: { deletedAt: null } },
		}),
		prisma.hackatimeLink.findMany({
			select: {
				cachedSeconds: true,
				cachedSpans: true,
				hackatimeProject: true,
				hoursApproved: true,
				phase: true,
				themeProject: { select: { userId: true } },
				themeProjectId: true,
			},
			where: { themeProject: { deletedAt: null } },
		}),
	])
	return { links, sessions, users }
}

type RegionInputs = Awaited<ReturnType<typeof loadRegionInputs>>

/** One (project, phase) worth of hours, ready to roll up. */
interface HoursByPhase {
	links: LinkRow[]
	sessions: SessionRow[]
	userId: string
}

export interface HoursByUser {
	/** Total hours per account. An account with nothing logged is absent rather than present at zero. */
	hours: Map<string, number>
	/**
	 * Phases where a link's minutes could not be measured against the journal's recordings, so the overlap was not subtracted.
	 *
	 * Non-zero means some of these totals are an over-count, and it says how much is unverified rather than leaving a deduplicated-looking number to be read as one. It is cold when the span cache is cold: `hackatime-sync` warms it every 15 minutes, and a phase that has never had one warmed is the reason the ledger reports the same unknown.
	 */
	overlapUnknownPhases: number
}

/**
 * Hours per account, read the way the ledger reads them.
 *
 * One definition, shared by the geography panels and the hours distribution, so the two can never disagree about what "hours" means – a total that differed between two panels on the same page would be worse than either being wrong on its own.
 *
 * Reviewer-approved hours replace the claimed figure wherever set; a tracked entry's hours arrive through its link, so the journal row itself contributes nothing. And the minutes a link counted that a timelapse recording of the same sitting already claimed are subtracted, because that is the same subtraction `rollUpHours` makes when a reviewer approves the phase – this used to add both sides of that overlap, so a recorded session that was also tracked was reported twice. Going through `rollUpHours` rather than repeating its arithmetic is the point: the rules here decide what people are paid, and a second copy that drifts is a second answer to "how many hours is this".
 *
 * Grouped by project *and* phase for the journal/link arithmetic, but the recordings a link is deduplicated against are not confined to that group: a clip attached in one week can carry tracked time that was linked on another week's project, and the recording's own Hackatime project is what pairs the two (see `windowsForLink`). Passing the maker's whole set of recordings through is what stops that sitting being counted on both sides.
 *
 * `frozenTotal` is deliberately not passed. These are the hours people logged, not the hours they were credited – the reviewer's frozen total is one number per (project, phase) and belongs on the project page, where a participant is reading their own.
 */
function hoursByUser(inputs: RegionInputs): HoursByUser {
	const phaseKey = (themeProjectId: string, phase: Phase) => `${themeProjectId}:${phase}`
	const phases = new Map<string, HoursByPhase>()
	const recordingsByUser = new Map<string, RecordedWindow[]>()
	const forPhase = (themeProjectId: string, phase: Phase, userId: string): HoursByPhase => {
		const key = phaseKey(themeProjectId, phase)
		let held = phases.get(key)
		if (!held) {
			held = { links: [], sessions: [], userId }
			phases.set(key, held)
		}
		return held
	}

	for (const s of inputs.sessions) {
		forPhase(s.themeProjectId, s.phase, s.themeProject.userId).sessions.push(s)
		if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
		const made = recordingsByUser.get(s.themeProject.userId) ?? []
		for (const t of s.timelapses) {
			const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
			if (window) made.push({ hackatimeProject: t.hackatimeProject, window })
		}
		recordingsByUser.set(s.themeProject.userId, made)
	}
	for (const l of inputs.links) forPhase(l.themeProjectId, l.phase, l.themeProject.userId).links.push(l)

	const hours = new Map<string, number>()
	let overlapUnknownPhases = 0
	for (const held of phases.values()) {
		const { computedTotal, hackatimeOverlapUnknown } = rollUpHours(
			held.sessions,
			held.links,
			null,
			recordingsByUser.get(held.userId) ?? [],
		)
		if (hackatimeOverlapUnknown) overlapUnknownPhases += 1
		hours.set(held.userId, (hours.get(held.userId) ?? 0) + computedTotal)
	}

	return { hours, overlapUnknownPhases }
}

function aggregateByKey(inputs: RegionInputs, byUser: HoursByUser, keyOf: (timezone: string | null) => string) {
	const userKey = new Map(inputs.users.map(u => [u.id, keyOf(u.timezone)]))
	const totals = new Map<string, { users: number; hours: number }>()
	const row = (key: string) => {
		let r = totals.get(key)
		if (!r) {
			r = { hours: 0, users: 0 }
			totals.set(key, r)
		}
		return r
	}

	for (const u of inputs.users) row(userKey.get(u.id) ?? "Unknown").users += 1
	for (const [userId, hours] of byUser.hours) row(userKey.get(userId) ?? "Unknown").hours += hours
	return totals
}

// Unknown always trails, whatever its size.
const rankLast = (key: string, users: number) => (key === "Unknown" ? -1 : users)

/** Users and hours per continent/area bucket. Ranked by users. */
export async function getAreaStats(): Promise<AreaStat[]> {
	const inputs = await loadRegionInputs()
	const totals = aggregateByKey(inputs, hoursByUser(inputs), tz => regionOfTimezone(tz))
	return REGIONS.map(({ id, label }) => ({
		hours: round1(totals.get(id)?.hours ?? 0),
		id,
		label,
		users: totals.get(id)?.users ?? 0,
	})).toSorted((a, b) => rankLast(b.label, b.users) - rankLast(a.label, a.users))
}

/** Users and hours per country, from each account's timezone. Ranked by users. */
export async function getCountryStats(): Promise<CountryStat[]> {
	const inputs = await loadRegionInputs()
	const totals = aggregateByKey(inputs, hoursByUser(inputs), countryOfTimezone)
	return [...totals]
		.filter(([, t]) => t.users > 0 || t.hours > 0)
		.map(([country, t]) => ({ country, hours: round1(t.hours), users: t.users }))
		.toSorted((a, b) => rankLast(b.country, b.users) - rankLast(a.country, a.users))
}

export interface DayActivity {
	/** YYYY-MM-DD in the program timezone, as the journal stamped it. */
	day: string
	devlogs: number
	/** Journal hours that day, reviewer-adjusted where set. */
	hours: number
	/** Distinct people who wrote one of those devlogs. The denominator for a per-user reading of the same day. */
	users: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Devlogs written and hours logged per day, gap-filled from the first active day to the last so the strip chart reads continuously. Days are program-timezone effective dates – the day the work counted for, not the instant it was typed.
 *
 * The distinct people behind each day come along too, because the totals and the per-user reading are the same rows and re-reading them for a second chart would be the same query twice. A person is counted once however many devlogs they wrote, so it is people rather than entries.
 */
export async function getDailyActivity(): Promise<DayActivity[]> {
	const sessions = await prisma.workSession.findMany({
		select: {
			effectiveDate: true,
			hoursApproved: true,
			hoursClaimed: true,
			hoursSource: true,
			// A session belongs to the project, not the person, so the user is reached through it.
			themeProject: { select: { userId: true } },
		},
		where: { deletedAt: null, themeProject: { deletedAt: null } },
	})

	const byDay = new Map<string, { devlogs: number; hours: number; users: Set<string> }>()
	for (const s of sessions) {
		const day = s.effectiveDate
		if (!day || !DAY.test(day)) continue
		let row = byDay.get(day)
		if (!row) {
			row = { devlogs: 0, hours: 0, users: new Set<string>() }
			byDay.set(day, row)
		}
		row.devlogs += 1
		row.users.add(s.themeProject.userId)
		if (s.hoursSource !== HoursSource.HACKATIME_TRACKED) row.hours += s.hoursApproved ?? s.hoursClaimed
	}

	const days = [...byDay.keys()].toSorted()
	if (days.length === 0) return []
	const out: DayActivity[] = []
	const [first, last] = [days[0] as string, days.at(-1) as string]
	for (let at = Date.parse(`${first}T00:00:00Z`); at <= Date.parse(`${last}T00:00:00Z`); at += 86_400_000) {
		const day = new Date(at).toISOString().slice(0, 10)
		const row = byDay.get(day)
		out.push({
			day,
			devlogs: row?.devlogs ?? 0,
			hours: round1(row?.hours ?? 0),
			users: row?.users.size ?? 0,
		})
	}
	return out
}

export interface ActiveDay {
	/** YYYY-MM-DD in the program timezone. */
	day: string
	/** People whose tracked time that day reached 15 minutes. */
	users: number
}

/**
 * Daily active users – people whose tracked time on a day reached 15 minutes – and today's count.
 *
 * Derived from the sessions themselves rather than read off `UserDay`, which is the same figure stored: that table is only rebuilt when somebody writes a session, so a deployment whose `analytics:backfill` has not run reads nearly empty there, while every other chart on this page reads the sessions directly. The rule is the one `UserDay` is built on (`isActiveDay`), applied in aggregate, so the two cannot mean different things – only one of them can be stale.
 *
 * A person counts once a day however many entries they wrote, and the bar is on the day's total rather than one entry: two ten-minute entries make a day active just as one twenty-minute entry does.
 *
 * Gap-filled from the first active day through today, so a quiet day is a zero on the line rather than a missing point and the last point is today – the same day the counter beside the chart reports.
 */
export async function getDailyActiveUsers(): Promise<{ days: ActiveDay[]; today: number }> {
	const { programTimezone } = await getProgramSettings()
	const today = effectiveDateFor(new Date(), programTimezone)

	const sessions = await prisma.workSession.findMany({
		select: {
			createdAt: true,
			effectiveDate: true,
			hoursClaimed: true,
			// A session belongs to the project, not the person, so the user is reached through it.
			themeProject: { select: { userId: true } },
		},
		where: { deletedAt: null, themeProject: { deletedAt: null } },
	})

	// day → (user → that person's hours that day), so the threshold is applied to a whole day rather than one entry.
	const totals = new Map<string, Map<string, number>>()
	for (const s of sessions) {
		const day = s.effectiveDate ?? effectiveDateFor(s.createdAt, programTimezone)
		let users = totals.get(day)
		if (!users) {
			users = new Map()
			totals.set(day, users)
		}
		users.set(s.themeProject.userId, (users.get(s.themeProject.userId) ?? 0) + s.hoursClaimed)
	}

	const byDay = new Map<string, number>()
	let first: string | null = null
	for (const [day, users] of totals) {
		let active = 0
		for (const hours of users.values()) if (isActiveDay(hours)) active++
		if (active === 0) continue
		byDay.set(day, active)
		if (first === null || day < first) first = day
	}

	const activeToday = byDay.get(today) ?? 0
	if (!first) return { days: [], today: activeToday }

	const days: ActiveDay[] = []
	for (let at = Date.parse(`${first}T00:00:00Z`); at <= Date.parse(`${today}T00:00:00Z`); at += 86_400_000) {
		const day = new Date(at).toISOString().slice(0, 10)
		days.push({ day, users: byDay.get(day) ?? 0 })
	}
	return { days, today: activeToday }
}

export interface GoalDayActivity {
	/** Journal hours and the people behind them, one entry per answer to the goal prompt, in `GOAL_OPTIONS` order. */
	byGoal: { goal: ParticipantGoal; hours: number; users: number }[]
	/** YYYY-MM-DD in the program timezone, as the journal stamped it. */
	day: string
}

/**
 * The same hours `getDailyActivity` counts, per day and split by what each person said they are here for.
 *
 * A separate read rather than a nested map on `DayActivity`: only one chart wants the split, and every other reader of the daily figures would carry it. It is the same rows either way – the same exclusions, the same gap-filling – so the two charts cannot disagree about a day they both draw.
 *
 * A maker who has not answered the prompt yet belongs to no line. The question is held open until it is answered, but it is asked after the first checkpoint, so the earliest days are largely people who had not been asked; reading an empty start as "nobody was working towards anything" would be reading the prompt's timing rather than the work.
 */
export async function getDailyActivityByGoal(): Promise<GoalDayActivity[]> {
	const sessions = await prisma.workSession.findMany({
		select: {
			effectiveDate: true,
			hoursApproved: true,
			hoursClaimed: true,
			hoursSource: true,
			themeProject: { select: { user: { select: { participantGoal: true } }, userId: true } },
		},
		where: { deletedAt: null, themeProject: { deletedAt: null } },
	})

	const byDay = new Map<string, Map<ParticipantGoal, { hours: number; users: Set<string> }>>()
	for (const s of sessions) {
		const day = s.effectiveDate
		const goal = s.themeProject.user.participantGoal
		if (!day || !DAY.test(day) || !goal) continue
		let goals = byDay.get(day)
		if (!goals) {
			goals = new Map()
			byDay.set(day, goals)
		}
		let row = goals.get(goal)
		if (!row) {
			row = { hours: 0, users: new Set<string>() }
			goals.set(goal, row)
		}
		// The person counts as active for their goal whatever the entry's source, but only a journal entry carries
		// journal hours – a HACKATIME_TRACKED one arrives through the link, the same exclusion `getDailyActivity` makes.
		row.users.add(s.themeProject.userId)
		if (s.hoursSource !== HoursSource.HACKATIME_TRACKED) row.hours += s.hoursApproved ?? s.hoursClaimed
	}

	const days = [...byDay.keys()].toSorted()
	if (days.length === 0) return []
	const out: GoalDayActivity[] = []
	const [first, last] = [days[0] as string, days.at(-1) as string]
	for (let at = Date.parse(`${first}T00:00:00Z`); at <= Date.parse(`${last}T00:00:00Z`); at += 86_400_000) {
		const day = new Date(at).toISOString().slice(0, 10)
		const goals = byDay.get(day)
		out.push({
			byGoal: GOAL_OPTIONS.map(option => ({
				goal: option.value,
				hours: round1(goals?.get(option.value)?.hours ?? 0),
				users: goals?.get(option.value)?.users.size ?? 0,
			})),
			day,
		})
	}
	return out
}

export interface HoursBucket {
	/** Hours summed across the bucket. */
	hours: number
	/** The bucket as it reads on the axis, e.g. "10-20". */
	label: string
	/** Accounts whose total lands in this bucket. */
	participants: number
}

export interface HoursDistribution {
	buckets: HoursBucket[]
	median: number | null
	/**
	 * Phases whose Hackatime overlap could not be measured, so their hours are counted on both sides and every total here is an over-count.
	 *
	 * Non-zero is a cache that has not caught up, not a calculation that went wrong – `hackatime-sync` warms the tracked intervals every 15 minutes. Surfaced rather than silently reported as deduplicated, because a total that looks like it has been deduplicated and has not is the harder error to catch later.
	 */
	overlapUnknownPhases: number
	totalHours: number
	/** Accounts with any hours at all – the histogram's denominator. */
	withHours: number
	/** Accounts with none. Most of them: everyone who signed up and never logged a devlog. */
	withoutHours: number
}

/**
 * The upper bound of each bucket, in hours.
 *
 * Uneven, and drawn as a set of bands rather than as a continuous scale: the distribution is long-tailed, so even
 * spacing would pile almost everyone into the first bucket. The first is open at zero because every account here
 * has at least some hours – the zero case is counted and reported rather than binned. The trailing Infinity edge
 * is the overflow band rather than a bound, so the tail has somewhere to land.
 */
export const HOUR_EDGES = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 60, 80, 120, 160, 240, Number.POSITIVE_INFINITY]

/**
 * Hours per account, bucketed, for the overview's distribution.
 *
 * Reads the same ledger as the geography panels (`hoursByUser`, which runs every one of these hours through `rollUpHours`), so this
 * and the continent and country pies are the same hours counted two ways rather than two definitions that could drift apart – which is
 * what they used to be, and they had: this panel added both sides of a timelapse overlap the ledger subtracts.
 *
 * Accounts with no hours are a count and not a bar. At three quarters of all accounts, a zero bar would be four
 * times every other and answer a question nobody asked.
 */
export async function getHoursDistribution(): Promise<HoursDistribution> {
	const inputs = await loadRegionInputs()
	const byUser = hoursByUser(inputs)
	const perUser = [...byUser.hours.values()].filter(h => h > 0).toSorted((a, b) => a - b)

	// One bucket per edge, so the trailing Infinity edge becomes the "160+" bar and catches the long tail.
	const last = HOUR_EDGES.length - 1
	const buckets: HoursBucket[] = HOUR_EDGES.map((upper, i) => ({
		hours: 0,
		label: i === last ? `${HOUR_EDGES[last - 1]}+` : i === 0 ? `under ${upper}` : `${HOUR_EDGES[i - 1]}–${upper}`,
		participants: 0,
	}))

	for (const hours of perUser) {
		const i = HOUR_EDGES.findIndex(upper => hours < upper)
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
		median: median === null ? null : round1(median),
		overlapUnknownPhases: byUser.overlapUnknownPhases,
		totalHours: round1(totalHours),
		withHours: perUser.length,
		withoutHours: Math.max(0, inputs.users.length - perUser.length),
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
		select: { starterProjectId: true },
		where: { deletedAt: null, theme: Theme.PCB, user: { onboardingCompletedAt: { not: null } } },
	})

	const counts = new Map<string | null, number>()
	for (const r of rows) counts.set(r.starterProjectId, (counts.get(r.starterProjectId) ?? 0) + 1)

	// Starter ids outlive the catalogue: resolve a title when one exists, else show the id prettified rather than dropped.
	const pretty = (id: string) =>
		getStarterProject(id)?.title
		?? id
			.split(/[-_]/)
			.map(w => (w ? w[0]?.toUpperCase() + w.slice(1) : w))
			.join(" ")

	return [...counts]
		.filter(([, users]) => users > 0)
		.map(([starterId, users]) => ({
			label: starterId === null ? "Custom project" : pretty(starterId),
			starter: starterId !== null,
			users,
		}))
		.toSorted((a, b) => b.users - a.users)
}

/** The four columns each week's cluster is split into. */
export interface WeekProjectCluster {
	/** What the axis prints: the theme, or the warm-up track. */
	label: string
	/** Which half of the season this week is, or null for the warm-up import, which is not scheduled at all. */
	phase: Phase | null
	/** Projects that took one of the suggested starter ideas. Locked to Tier 1, so never also a custom column. */
	starter: number
	tier1: number
	tier2: number
	tier3: number
	/** 0 for the warm-up import, then the ten program weeks in order. */
	week: number
}

/**
 * Which column a project belongs in.
 *
 * A starter is its own column rather than a tier: picking one locks the request to Tier 1, so counting it as a custom tier-1 would make the two indistinguishable, and which of them a week is funding is exactly the question.
 *
 * The tier is `tier ?? requestedTier` – the reviewer's once they have set one, the maker's ask until then – the same resolution `lib/bom` and the admin project filters use. Null is only legal alongside a starter, which returned above, so anything left over is a tier-1 request.
 */
function projectColumn(project: {
	starterProjectId: string | null
	tier: number | null
	requestedTier: number | null
}): "starter" | "tier1" | "tier2" | "tier3" {
	if (project.starterProjectId) return "starter"
	const tier = project.tier ?? project.requestedTier
	if (tier === 2) return "tier2"
	if (tier === 3) return "tier3"
	return "tier1"
}

/** One column of the season, before any measure is put in it. */
interface WeekSlot {
	label: string
	phase: Phase | null
	week: number
}

/**
 * Every week of the season in order: the warm-up import, then the ten scheduled weeks.
 *
 * Shared by the two per-week charts so their axes cannot drift – both draw one column per entry here, which is what makes them readable side by side. A week the schedule has nothing for is still a column, labelled by number, so the axis draws the whole season rather than the part of it that has been reached.
 */
function weekSlots(): WeekSlot[] {
	const slots: WeekSlot[] = [{ label: WARMUP_THEME.label, phase: null, week: WARMUP_WEEK_ID }]
	for (let week = 1; week <= TOTAL_WEEKS; week++) {
		const scheduled = scheduleForWeek(week)
		slots.push({ label: scheduled ? scheduled.theme.label : `Week ${week}`, phase: scheduled?.phase ?? null, week })
	}
	return slots
}

/**
 * How many projects are in each stage, by the week that stage runs in.
 *
 * A project is in a week's column when that week's phase is actually under way – `designStatus` or `buildStatus` has left `draft`, which happens the first time the phase is submitted. A project that has been designed and built therefore appears in both of its theme's weeks, which is correct: those are two pieces of work, five weeks apart, and each is its own thing a week is funding.
 *
 * What this deliberately no longer does is count every project in both weeks regardless. That made a theme's two columns identical – 2,178 PCB projects in week 1 and the same 2,178 in week 6 – when only a fraction had reached the build. A named project nothing has happened to yet is in neither column, because no week is funding it yet.
 *
 * The warm-up track needs no special case: it is one phase on one of the two statuses, and `weekOfPhase` sends both to the single warm-up column.
 */
export async function getProjectsByWeek(): Promise<WeekProjectCluster[]> {
	const projects = await prisma.themeProject.findMany({
		select: {
			buildStatus: true,
			designStatus: true,
			requestedTier: true,
			starterProjectId: true,
			theme: true,
			tier: true,
		},
		where: { deletedAt: null },
	})

	const clusters = new Map<number, WeekProjectCluster>()
	for (const slot of weekSlots()) clusters.set(slot.week, { ...slot, starter: 0, tier1: 0, tier2: 0, tier3: 0 })

	for (const project of projects) {
		const column = projectColumn(project)
		for (const phase of [Phase.DESIGN, Phase.BUILD]) {
			// The same threshold `getHoursByWeek` reads: a phase starts being one of these stages when it stops being a draft, so the two charts change together rather than one counting a project the other has no hours for.
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status === PhaseStatus.draft) continue
			const cluster = clusters.get(weekOfPhase(project.theme, phase))
			// A theme scheduled outside the season draws nowhere rather than inventing a column for itself.
			if (!cluster) continue
			cluster[column] += 1
		}
	}

	return [...clusters.values()].toSorted((a, b) => a.week - b.week)
}

export interface WeekHoursCluster {
	/** What the axis prints: the theme, or the warm-up track. */
	label: string
	/** Which half of the season this week is, or null for the warm-up import, which is not scheduled at all. */
	phase: Phase | null
	/** Hours logged by starter projects in this week, and so on down the four columns. */
	starter: number
	tier1: number
	tier2: number
	tier3: number
	/** 0 for the warm-up import, then the ten program weeks in order. */
	week: number
}

/**
 * The week a phase's hours belong to: the theme's own design or build week, or the warm-up track for everything off-season.
 *
 * The same two weeks `getProjectsByWeek` places a project's stages in, so the two charts describe one cohort. Phase decides which of the two, which is also what keeps every logged hour counted exactly once – a build week's column is the build phases of its projects, not their design phases as well.
 */
function weekOfPhase(theme: Theme, phase: Phase): number {
	if (theme === Theme.WARMUP) return WARMUP_WEEK_ID
	const def = getThemeDef(theme)
	return phase === Phase.DESIGN ? def.designWeek : def.buildWeek
}

/**
 * Hours logged for each week, split by what kind of project each hour belongs to.
 *
 * The companion to `getProjectsByWeek`: the same eleven columns and the same four kinds, measured in the hours each stage's projects have put in rather than how many of them there are. Read together, one says how much work a week's stage represents and this says how many projects are carrying it.
 *
 * Each hour is counted once. A project's phases are attributed to their own weeks rather than the whole project being counted in both – an hours chart that added a project's build hours to its design week as well would not be measuring anything that happened. The warm-up track is one column because a warm-up is one submission with one phase, so there is no second week to separate out.
 *
 * The hours are the ledger's, through `rollUpHours` on each (project, phase) – the same call the project page and the reviewer's numbers use, so a sitting that was both journalled and tracked is not counted twice here either. A project named but never logged against contributes nothing, which is why a week can be busy on the projects chart and flat on this one.
 */
export async function getHoursByWeek(): Promise<WeekHoursCluster[]> {
	const projects = await prisma.themeProject.findMany({
		select: {
			hackatimeLinks: {
				select: {
					cachedSeconds: true,
					cachedSpans: true,
					hackatimeProject: true,
					hoursApproved: true,
					phase: true,
				},
			},
			requestedTier: true,
			starterProjectId: true,
			theme: true,
			tier: true,
			userId: true,
			workSessions: {
				select: {
					hoursApproved: true,
					hoursClaimed: true,
					hoursSource: true,
					phase: true,
					timelapses: { select: { coveredSeconds: true, hackatimeProject: true, recordedAt: true } },
				},
				where: { deletedAt: null },
			},
		},
		where: { deletedAt: null, namedAt: { not: null } },
	})

	const clusters = new Map<number, WeekHoursCluster>()
	for (const slot of weekSlots()) clusters.set(slot.week, { ...slot, starter: 0, tier1: 0, tier2: 0, tier3: 0 })

	// Each maker's recordings, whatever project or phase they were attached to, so a link is measured against the ones that name its project even when they live on another week's project.
	const recordingsByUser = new Map<string, RecordedWindow[]>()
	for (const project of projects) {
		const made = recordingsByUser.get(project.userId) ?? []
		for (const s of project.workSessions) {
			if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
			for (const t of s.timelapses) {
				const window = timelapseWindow(t.recordedAt, t.coveredSeconds)
				if (window) made.push({ hackatimeProject: t.hackatimeProject, window })
			}
		}
		recordingsByUser.set(project.userId, made)
	}

	for (const project of projects) {
		const column = projectColumn(project)
		const recordings = recordingsByUser.get(project.userId) ?? []

		// Grouped by phase for the journal/link arithmetic, but the recordings a link is deduplicated against cross phases and projects by project name (see `windowsForLink`).
		for (const phase of [Phase.DESIGN, Phase.BUILD]) {
			const sessions = project.workSessions.filter(s => s.phase === phase)
			const links = project.hackatimeLinks.filter(l => l.phase === phase)
			if (sessions.length === 0 && links.length === 0) continue

			const { computedTotal } = rollUpHours(sessions, links, null, recordings)
			const cluster = clusters.get(weekOfPhase(project.theme, phase))
			// A theme scheduled outside the season draws nowhere rather than inventing a column for itself.
			if (!cluster) continue
			cluster[column] += computedTotal
		}
	}

	// Rounded once per column rather than per project, so a week's total is not a sum of eleven hundred individually-rounded hours.
	for (const cluster of clusters.values()) {
		cluster.starter = round1(cluster.starter)
		cluster.tier1 = round1(cluster.tier1)
		cluster.tier2 = round1(cluster.tier2)
		cluster.tier3 = round1(cluster.tier3)
	}

	return [...clusters.values()].toSorted((a, b) => a.week - b.week)
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
	const rows = await prisma.user.groupBy({ _count: { _all: true }, by: ["verificationStatus"] })
	return rows
		.filter(row => row._count._all > 0)
		.map(row => ({
			label:
				row.verificationStatus === null
					? "Not asked"
					: (VERIFICATION_STATUS_LABELS[row.verificationStatus] ?? row.verificationStatus),
			users: row._count._all,
		}))
		.toSorted((a, b) => b.users - a.users)
}

/**
 * HCA's own words for the states it reports. An unknown one is shown verbatim rather than dropped, so a status HCA adds later still shows up instead of vanishing into a hole in the ring.
 */
const VERIFICATION_STATUS_LABELS: { [_: string]: string } = {
	ineligible: "Ineligible",
	needs_submission: "Needs submission",
	pending: "Pending",
	verified: "Verified",
}

export interface ReviewerResultStat {
	result: ReviewResult
	/** Distinct projects whose most recent live review is this one, written today. */
	today: number
	/** The same, across the whole program. */
	total: number
}

export interface ReviewerStats {
	/** One row per outcome, so the rows add up to the two figures above them. */
	byResult: ReviewerResultStat[]
	/** Distinct projects with a live review written today, program-timezone day. */
	reviewedToday: number
	/** Distinct projects carrying at least one live review. */
	reviewedTotal: number
}

/**
 * How much has been reviewed, mirrored locally so the overview answers it without opening Ari.
 *
 * Counted over live decisions only. A review an admin un-approved or Ari reverted is marked `invalidated`, and a row that no longer stands is not a decision the project still has – counting it would make the total only ever grow and leave it disagreeing with Ari after a revert. Only FINAL passes count: a FIRST-pass row is advisory and moves no status and no money (see the ReviewPass enum), so including it would credit a reviewer with a decision they did not make.
 *
 * A project counts once however many of its phases were reviewed. A project is reviewed at most twice, design then build, and the question here is how much has had attention rather than how many hand-ins landed; `getAdminCounters`'s "awaiting review" remains the submission-level figure. Neither is meant to equal a total in Ari's own UI, which counts ships rather than projects, so a reader comparing the two is comparing two different questions. The breakdown attributes each project to its most recent live review so the three outcome rows always add up to the headline above them: a project whose design was approved and whose build came back for changes reads as changes requested, which is where it actually stands.
 *
 * "Today" is the program timezone's day, the same boundary the activity strip and streaks use, so a review that landed at 11pm New York counts the day the dashboard is on rather than the server's.
 *
 * Ari's decisions are included – they reach this table through the same `finalizeReview` a console reviewer calls, and leaving them out is exactly the gap this closes.
 */
export async function getReviewerStats(): Promise<ReviewerStats> {
	const [{ programTimezone }, reviews] = await Promise.all([
		getProgramSettings(),
		prisma.submissionReview.findMany({
			// Newest first, so the first row seen for a project is that project's most recent live review.
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			select: { createdAt: true, result: true, submission: { select: { themeProjectId: true } } },
			where: { invalidated: false, pass: ReviewPass.FINAL, submission: { themeProject: { deletedAt: null } } },
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
		byResult: Object.values(ReviewResult).map(result => ({
			result,
			today: projects.filter(p => p.result === result && p.today).length,
			total: projects.filter(p => p.result === result).length,
		})),
		// A project reviewed today can only have been reviewed today by its latest review, so this is the same set the breakdown counts.
		reviewedToday: projects.filter(p => p.today).length,
		reviewedTotal: projects.length,
	}
}

export interface ProjectReviewStatusStat {
	label: string
	value: number
}

/**
 * The review board as Ari shows it: one row per ship, by the decision standing on it now.
 *
 * Ari counts ships, not projects – a (project, phase) hand-in – so this counts the latest submission per phase rather than reading the project's status columns. The columns answer a different question: they follow the phase's *current* step, so a design approved long ago reads as pending once its build is handed in, and a sent-back design reads as pending the moment it is resubmitted. That is why the old version showed everything as pending while Ari showed hundreds of standing decisions.
 *
 * Each phase contributes at most one slice, decided by its newest submission: an unresolved hand-in Ari holds is pending; a decided one reads from its live FINAL review, falling back to the submission's own recorded result. An un-approval invalidates the review without reopening the submission, so a decided submission with no live review left keeps its recorded result rather than vanishing. A hand-in Ari never received (`ariSubmissionId` null) is counted nowhere – it is not on Ari's board either, and the reviewer-activity panel already counts it apart.
 */
export async function getProjectReviewStatuses(): Promise<ProjectReviewStatusStat[]> {
	const submissions = await prisma.phaseSubmission.findMany({
		// Newest first, so the first row seen for a phase is that phase's current ship.
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		select: {
			ariDecision: true,
			ariSubmissionId: true,
			phase: true,
			resolvedAt: true,
			resolvedResult: true,
			reviews: {
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				select: { result: true },
				take: 1,
				where: { invalidated: false, pass: ReviewPass.FINAL },
			},
			themeProjectId: true,
		},
		where: { themeProject: { deletedAt: null } },
	})

	const latest = new Map<string, (typeof submissions)[number]>()
	for (const submission of submissions) {
		const key = `${submission.themeProjectId}:${submission.phase}`
		if (!latest.has(key)) latest.set(key, submission)
	}

	let pending = 0
	let needsChanges = 0
	let rejected = 0
	let approved = 0
	for (const submission of latest.values()) {
		if (submission.resolvedAt === null) {
			if (submission.ariSubmissionId !== null) pending += 1
			continue
		}
		const result = submission.reviews[0]?.result ?? submission.resolvedResult ?? ariToResult(submission.ariDecision)
		if (result === ReviewResult.APPROVED) approved += 1
		else if (result === ReviewResult.RETURNED) needsChanges += 1
		else if (result === ReviewResult.REJECTED) rejected += 1
		// A resolved submission with no recorded outcome at all is corrupt data, not a slice: counted nowhere rather than misfiled.
	}

	return [
		{ label: "Approved", value: approved },
		{ label: "Needs changes", value: needsChanges },
		{ label: "Rejected", value: rejected },
		{ label: "Pending", value: pending },
	]
}

/** The decision string Ari reports, back into the enum the reviews table speaks. */
function ariToResult(decision: string | null): ReviewResult | null {
	if (decision === "approved") return ReviewResult.APPROVED
	if (decision === "changes") return ReviewResult.RETURNED
	if (decision === "rejected") return ReviewResult.REJECTED
	// Ari is an external system, so a decision string we do not know is a vocabulary drift, not corrupt local data: log it rather than let the submission vanish from the chart silently.
	if (decision !== null) console.warn(`[admin] unrecognised Ari decision "${decision}"; counted nowhere`)
	return null
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

/**
 * The journey as a Sankey: left-to-right columns of stages, a ribbon per route people actually took.
 *
 * This is the shape the funnel cannot draw. The funnel is one spine and every row is "also did everything above it", so it can only report cumulative survival – it cannot say that a quarter of makers journal and never post, nor that a maker who posted in week one and journalled in week four is the same shape as one who did it the other way round. Here each stage is a column and a skipped stage is a visible gap the ribbon steps over, and a fork is two ribbons of different widths rather than one number. The one exception is the activity stage, where a maker sits in every box they earned rather than at most one.
 *
 * Every stage except the first is optional, so a person contributes to the box they qualify for and the ribbon then jumps to the next stage they reach. A person who reached nothing after signing up is a ribbon that ends, which is a dead end the funnel has no way to draw.
 *
 * The journey stages are the funnel's own steps, in the funnel's order and read the funnel's way, so the two views can be laid side by side stage for stage: onboarding is broken out into each question the state machine records rather than collapsed into one "Setup" column. What the Sankey adds and the funnel cannot is the branch: one shared activity stage, where devlogs, Hackatime, Lapse and reels sit as ribbons of whatever width they really are, and an outcome column that says what happened to a hand-in rather than stopping at "submitted". The tracked-time evidence is drawn here and nowhere else – the funnel used to carry those rows as its own section, which put the same fact in two shapes that could not both be right.
 *
 * Every stage after the first is optional, so a person contributes to the box they qualify for and the ribbon then jumps to the next stage they reach. A person who reached nothing after signing up is a ribbon that ends, which is a dead end the funnel has no way to draw.
 *
 * The activity stage counts every kind the person reached, not a ranked first and second: a maker who both journalled and linked Hackatime feeds both boxes, so the links around this one stage carry more units than the people. Each kind still contributes only its earliest timestamp to membership, so one prolific maker cannot fill a box twice – but order between kinds is deliberately unread: "devlog then reel" and "reel then devlog" are the same pair of ribbons now, because rank told us which came first and nothing about which mattered.
 *
 * Read straight off the tables rather than the User analytics markers wherever a marker exists only after a backfill: the funnel needs `distinct: ["userId"]` on Session for the same reason. A missing analytics column must not silently read as "nobody did this".
 */
export async function getUserFlowSankey(): Promise<{ diagram: SankeyDiagram; activityShare: ActivityShare }> {
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
		prisma.user.findMany({
			select: {
				firstChecksPassedAt: true,
				firstProjectAt: true,
				hardwareExperience: true,
				id: true,
				onboardingCompletedAt: true,
				onboardingStep: true,
				participantGoal: true,
			},
		}),
		// A sign-in is what issues a session. Read off the table rather than the `lastLoginAt` marker, so a backfill that never ran cannot read as "nobody logged in".
		prisma.session.findMany({ distinct: ["userId"], select: { userId: true } }),
		// The onboarding paper trail, per person, read off live projects. Not `namedAt`: that marker was stamped later, so it misses the projects that predate it. One read for all three, because the journey stages need them together.
		prisma.themeProject.findMany({
			select: {
				createdAt: true,
				description: true,
				id: true,
				requestedTier: true,
				starterProjectId: true,
				userId: true,
			},
			where: { deletedAt: null },
		}),
		// The same "a real devlog" rule as the funnel's devlogged step: a HACKATIME_TRACKED row with no timelapse is only a link, not work.
		prisma.workSession.findMany({
			select: { createdAt: true, themeProject: { select: { userId: true } } },
			where: {
				deletedAt: null,
				OR: [{ hoursSource: { not: HoursSource.HACKATIME_TRACKED } }, { timelapses: { some: {} } }],
				themeProject: { deletedAt: null },
			},
		}),
		// A maker's own post, not a staff announcement: an announcement in their feed is not something they did.
		prisma.post.findMany({
			select: { createdAt: true, publishedAt: true, userId: true },
			where: { deletedAt: null, kind: { not: PostKind.ANNOUNCEMENT } },
		}),
		prisma.themeProject.findMany({
			select: { createdAt: true, userId: true },
			where: {
				deletedAt: null,
				OR: [{ githubRepo: { not: null } }, { repoSyncRepo: { not: null } }, { repoSyncEnabled: true }],
			},
		}),
		prisma.hackatimeLink.findMany({
			select: { createdAt: true, themeProject: { select: { userId: true } } },
			where: { themeProject: { deletedAt: null } },
		}),
		prisma.sessionTimelapse.findMany({
			select: { createdAt: true, workSession: { select: { themeProject: { select: { userId: true } } } } },
			where: { workSession: { deletedAt: null, themeProject: { deletedAt: null } } },
		}),
		// The decision on each hand-in, to end the journey in an outcome rather than at "submitted".
		prisma.phaseSubmission.findMany({
			select: { resolvedAt: true, resolvedResult: true, themeProject: { select: { userId: true } } },
			where: { themeProject: { deletedAt: null } },
		}),
		// Design hours per project, for the tier-requirements stage: journal claims outside the tracked-link stream, plus the Hackatime cache, so one wall hour is not counted twice in the common case. An approximation of the sheet's own arithmetic – reviewer adjustments and overlap edge cases stay server-side – but the right shape for "has this tier's floor been worked".
		prisma.workSession.groupBy({
			_sum: { hoursClaimed: true },
			by: ["themeProjectId"],
			where: {
				deletedAt: null,
				hoursSource: { not: HoursSource.HACKATIME_TRACKED },
				phase: Phase.DESIGN,
				themeProject: { deletedAt: null },
			},
		}),
		prisma.hackatimeLink.groupBy({
			_sum: { cachedSeconds: true },
			by: ["themeProjectId"],
			where: { phase: Phase.DESIGN, themeProject: { deletedAt: null } },
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
		...devlogs.map(s => ({ at: s.createdAt, key: "devlog" as const, userId: s.themeProject.userId })),
		...reels.map(p => ({ at: p.publishedAt ?? p.createdAt, key: "reel" as const, userId: p.userId })),
		...repoLinks.map(p => ({ at: p.createdAt, key: "repo" as const, userId: p.userId })),
		...hackatimeLinks.map(l => ({ at: l.createdAt, key: "hackatime" as const, userId: l.themeProject.userId })),
		...timelapses.map(t => ({
			at: t.createdAt,
			key: "timelapse" as const,
			userId: t.workSession.themeProject.userId,
		})),
	])

	const described = new Set(
		projects
			.filter(p => (p.description !== null && p.description !== "") || p.starterProjectId !== null)
			.map(p => p.userId),
	)

	// The journey stages before the branches. Read the same way the funnel reads them, so the two views line up on the path: a step is reached when the onboarding state machine is at or past it, and each accepts the branch that skips it (a starter pick jumps the project and idea questions) so nobody is drawn as having missed a step they were never asked.
	const loggedIn = new Set(sessions.map(s => s.userId))
	const tookStarter = new Set(projects.filter(p => p.starterProjectId !== null).map(p => p.userId))
	const pickedTier = new Set(projects.filter(p => p.requestedTier !== null).map(p => p.userId))
	const ONBOARDING = {
		idea: stepIndexOf("idea"),
		repo: stepIndexOf("repo"),
		tracking: stepIndexOf("tracking"),
		week: stepIndexOf("week"),
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

	/**
	 * The tier each person is working at, and whether they have worked its floor: the chosen tier of their most recent live project (starters count as tier 1), against design journal hours plus Hackatime cache on that project. An approximation of the submit sheet's own arithmetic, documented where the hours are read – close enough for "will they be allowed to submit", which is what this stage asks.
	 */
	const userTier = new Map<string, 1 | 2 | 3>()
	const tierMet = new Map<string, boolean>()
	{
		const journalByProject = new Map(designHours.map(row => [row.themeProjectId, row._sum.hoursClaimed ?? 0]))
		const hackByProject = new Map(
			designHackatime.map(row => [row.themeProjectId, (row._sum.cachedSeconds ?? 0) / 3600]),
		)
		const latest = new Map<string, { project: (typeof projects)[number]; tier: 1 | 2 | 3 }>()
		for (const project of projects) {
			const raw = project.requestedTier ?? (project.starterProjectId !== null ? STARTER_PROJECT_TIER : null)
			if (!isTierId(raw)) continue
			const held = latest.get(project.userId)
			if (!held || project.createdAt > held.project.createdAt) latest.set(project.userId, { project, tier: raw })
		}
		for (const [userId, { project, tier }] of latest) {
			userTier.set(userId, tier)
			const floor = TIERS.find(t => t.id === tier)?.fundingHours ?? 0
			const hours = (journalByProject.get(project.id) ?? 0) + (hackByProject.get(project.id) ?? 0)
			tierMet.set(userId, hours >= floor)
		}
	}

	/** "tier1"…"tier3" for the stage, null when they never chose one. */
	const tierBox = (userId: string): string | null => {
		const tier = userTier.get(userId)
		return tier === undefined ? null : `tier${tier}`
	}
	/** Whether the chosen tier's floor has been worked. Never set without the tier box above it. */
	const metBox = (userId: string): string | null => {
		if (userTier.get(userId) === undefined) return null
		return tierMet.get(userId) === true ? "tierMet" : "tierUnmet"
	}

	/** Users with a live project row, named or not – the marker only stamps on description, and descriptions are enforced at submit time, so the marker alone would leave this box structurally empty. */
	const liveProjectUsers = new Set(projects.map(p => p.userId))

	/** Every tracked activity the person reached, in branch order so the boxes line up with the stage. One maker appears in as many boxes as they earned – or in the none box, when a finisher earned none. */
	const activityBoxes = (userId: string, completed: boolean): string[] => {
		const did = SANKEY_ACTIVITY.filter(a => activity.get(userId)?.has(a.key)).map(a => activityNode(a.key))
		return did.length > 0 || !completed ? did : [NONE_BOX]
	}

	/** The person's box at each stage, null where they never got there. The activity boxes sit together as one block. */
	const boxesOf = (user: (typeof users)[number]): (string | null)[] => {
		const completed = user.onboardingCompletedAt !== null
		const started = user.hardwareExperience !== null || completed || user.firstProjectAt !== null
		const step = user.onboardingStep
		const reached = (n: number) => step >= n || completed
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
			// The complements that make the gates visible: finishers who never got a project live, or never answered the goal prompt (mostly accounts from before it shipped – it cannot be dismissed now). Scoped to finishers so the boxes stay a finding about drop-off rather than everyone who never started.
			user.firstProjectAt !== null ? "projectLive" : completed ? "projectMissing" : null,
			user.participantGoal !== null ? "goalSet" : completed ? "goalMissing" : null,
			...activityBoxes(user.id, completed),
			// A project that never passed checks cannot be handed in – the sheet and the server both refuse it – so this box is the gate's bite: live projects stuck before review.
			user.firstChecksPassedAt !== null ? "checksPassed" : user.firstProjectAt !== null ? "checksStalled" : null,
			// The chosen tier of their latest project, and whether its funded hours have been worked – the two halves of "can they submit on it". No tier chosen, no boxes; the met box follows the tier box, never appears alone.
			tierBox(user.id),
			metBox(user.id),
			// Live project row, never submitted: the hand-in that is still awaited, distinct from never starting at all. Outcome below still reads never submitted – factually true – with this box saying they have something to hand in.
			outcomeNode.has(user.id) ? "handedIn" : liveProjectUsers.has(user.id) ? "awaitingHandIn" : null,
			outcomeNode.get(user.id) ?? "neverHandedIn",
		]
	}

	const counts = new Map<string, number>()
	const linkCounts = new Map<string, { value: number; fan: "out" | "in" | null }>()
	const link = (from: string, to: string, fan: "out" | "in" | null) => {
		const key = `${from}\u0000${to}`
		const held = linkCounts.get(key)
		if (held) held.value += 1
		else linkCounts.set(key, { fan, value: 1 })
	}
	for (const user of users) {
		const boxes = boxesOf(user).filter((box): box is string => box !== null)
		for (const box of boxes) counts.set(box, (counts.get(box) ?? 0) + 1)
		// The activity block fans out and back in: one ribbon per activity the person reached, from their last box before the block and to their first box after it. Fan-out ribbons share their source's people and fan-in ribbons their target's, so each direction flags its own edge for the renderer to overlap; every other ribbon carries disjoint users and stacks.
		const firstAct = boxes.findIndex(box => ACTIVITY_BOXES.has(box))
		if (firstAct === -1) {
			for (let i = 1; i < boxes.length; i++) link(boxes[i - 1] as string, boxes[i] as string, null)
			continue
		}
		let lastAct = firstAct
		while (lastAct + 1 < boxes.length && ACTIVITY_BOXES.has(boxes[lastAct + 1] as string)) lastAct++
		// "joined" is unconditional, so a block always has a box before it.
		const prev = boxes[firstAct - 1] as string
		for (let i = 1; i < firstAct; i++) link(boxes[i - 1] as string, boxes[i] as string, null)
		for (let i = firstAct; i <= lastAct; i++) link(prev, boxes[i] as string, boxes[i] === NONE_BOX ? null : "out")
		const next = boxes[lastAct + 1]
		if (next) {
			for (let i = firstAct; i <= lastAct; i++) link(boxes[i] as string, next, boxes[i] === NONE_BOX ? null : "in")
			for (let i = lastAct + 2; i < boxes.length; i++) link(boxes[i - 1] as string, boxes[i] as string, null)
		}
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
		{ label: "Project", nodes: ["projectLive", "projectMissing"] },
		{ label: "Goal", nodes: ["goalSet", "goalMissing"] },
		{ label: "Activity", nodes: [...activityNodes(), NONE_BOX] },
		{ label: "Repo checks", nodes: ["checksPassed", "checksStalled"] },
		{ label: "Tier", nodes: ["tier1", "tier2", "tier3"] },
		{ label: "Tier hours", nodes: ["tierMet", "tierUnmet"] },
		{ label: "Hand-in", nodes: ["handedIn", "awaitingHandIn"] },
		{ label: "Outcome", nodes: SANKEY_OUTCOME.map(o => o.node) },
	]

	const labels: { [_: string]: string } = {
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

	// What share of onboarded finishers did each tracked activity: the same activity rows as the Sankey, cut to the people who finished onboarding rather than everyone who signed up. Largest first, so the chart reads left to right; ties keep branch order.
	const finishers = users.filter(user => user.onboardingCompletedAt !== null)
	const reachedCount = (key: ActivityKey | "none") =>
		key === "none"
			? finishers.filter(user => !activity.get(user.id)).length
			: finishers.filter(user => activity.get(user.id)?.has(key)).length
	const activityShare: ActivityShare = {
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

	// Only boxes someone actually reached are drawn: a branch nobody took is not a finding, and an empty box in the middle of the diagram reads as a bug.
	const nodes = stages.flatMap(stage =>
		stage.nodes.map(id => ({ id, label: labels[id] ?? id, value: counts.get(id) ?? 0 })).filter(node => node.value > 0),
	)
	const live = new Set(nodes.map(n => n.id))

	return {
		activityShare,
		diagram: {
			links: [...linkCounts]
				.map(([key, entry]) => {
					const [source, target] = key.split("\u0000")
					return { fan: entry.fan, source: source as string, target: target as string, value: entry.value }
				})
				.filter(edge => live.has(edge.source) && live.has(edge.target)),
			nodes,
			stages,
			total: users.length,
		},
	}
}
