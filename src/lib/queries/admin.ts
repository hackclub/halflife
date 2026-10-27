import "server-only"
import { and, or } from "@prisma/orm-postgres/orm-client"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { isActiveDay } from "@/lib/analytics"
import { countAriShips } from "@/lib/ari-counts"
import { GOAL_OPTIONS } from "@/lib/config/goal"
import { getStarterProject, STARTER_PROJECT_TIER, stepIndexOf } from "@/lib/config/onboarding"
import { scheduledWeekFor, scheduleForWeek, TOTAL_WEEKS, WARMUP_THEME, WARMUP_WEEK_ID } from "@/lib/config/program"
import { getTier, isTierId } from "@/lib/config/tiers"
import { type Balances, getBalances, type LedgerEntryRow } from "@/lib/currency"
import { displayName } from "@/lib/display-name"
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
} from "@/lib/enums"
import { type LinkRow, rollUpHours, type SessionRow } from "@/lib/hours"
import { type RecordedWindow, timelapseWindow } from "@/lib/hours-overlap"
import { pctOf, round1 } from "@/lib/numbers"
import { decodeCursor, encodeCursor, readCursor } from "@/lib/pagination"
import { safeDecrypt } from "@/lib/pii"
import { getPrinterQualification, type PrinterQualification } from "@/lib/printer"
import db from "@/lib/prisma8"
import { effectiveDateFor, getProgramSettings, startOfDay, weekNumberForDate } from "@/lib/program"
import { countryOfTimezone, REGIONS, type RegionId, regionOfTimezone } from "@/lib/regions"
import { projectReviewState } from "@/lib/review-state"
import { withFields } from "@/lib/rows"
import { containsPattern } from "@/lib/text"
import { eachDayBetween, formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

/** One row of the admin user directory, with contact and risk fields blanked unless the caller may see PII. */
export interface DirectoryUser {
	bannedAt: string | null
	createdAt: Date
	displayName: string | null
	email: string
	fraudFlagged: boolean
	id: string
	name: string | null
	roles: { role: Role }[]
	slackId: string | null
	suspendedUntil: string | null
	verificationStatus: string | null
}

export async function listUsers(
	opts: { q?: string; cursor?: string; limit: number },
	flags?: { includePii?: boolean },
): Promise<{ items: DirectoryUser[]; nextCursor: string | null }> {
	const includePii = flags?.includePii ?? false
	const ordered = db.orm.public.User.orderBy([user => user.createdAt.desc(), user => user.id.desc()])
	// Without PII the search box matches names only. Matching an address or a Slack id would turn the directory into a registration oracle: anybody holding VIEW_USERS could confirm whether a given person has an account here.
	const term = opts.q
	const pattern = term === undefined ? null : containsPattern(term)
	const filtered =
		pattern === null
			? ordered
			: ordered.where(user =>
					or(
						user.name.ilike(pattern),
						user.displayName.ilike(pattern),
						// The PII columns are only searched when the caller may see them, per the rule above.
						...(includePii ? [user.email.ilike(pattern), user.slackId.ilike(pattern)] : []),
					),
				)
	const position = readCursor(opts.cursor)
	// The directory is rendered as a page as well as served as an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged =
		position?.at === undefined || position?.at === null
			? filtered
			: filtered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
	const rows = await paged
		.limit(opts.limit + 1)
		.select(
			"bannedAt",
			"createdAt",
			"displayName",
			"email",
			"fraudFlagged",
			"id",
			"name",
			"slackId",
			"suspendedUntil",
			"verificationStatus",
		)
		.include("roles", roles => roles.select("role"))
		.all()
	const items = rows.slice(0, opts.limit).map(row => withFields(row, { createdAt: parseDbTimestamp(row.createdAt) }))
	const last = items.at(-1)
	// Contact + risk fields only leave the server for ADMIN/AUDITOR. REVIEWER/FULFILLER get the directory (names + roles) with no emails, Slack ids or fraud flags to scrape. Callers pass includePii explicitly; the default is stripped.
	return {
		items: includePii
			? items
			: items.map(row =>
					Object.assign(row, { email: "", fraudFlagged: false, slackId: null, verificationStatus: null }),
				),
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
	}
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

/** One row of the admin project directory, with its owner's directory fields. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface ProjectDirectoryRow {
	buildStatus: Models.public_ThemeProject["buildStatus"]
	designStatus: Models.public_ThemeProject["designStatus"]
	githubRepo: string | null
	id: string
	requestedTier: number | null
	submissionExtensionUntil: Date | null
	theme: Models.public_ThemeProject["theme"]
	tier: number | null
	title: string
	updatedAt: Date
	user: {
		displayName: string | null
		email: string
		id: string
		name: string | null
		slackId: string | null
		submissionExtensionUntil: Date | null
	}
}

export async function listProjects(
	opts: ProjectFilters & { cursor?: string; limit: number },
	flags?: { includePii?: boolean },
): Promise<{ items: ProjectDirectoryRow[]; nextCursor: string | null }> {
	const includePii = flags?.includePii ?? false
	const now = new Date()
	const nowText = formatDbTimestamp(now)
	const q = opts.q?.trim()
	const { tier } = opts
	// Every filter ANDs, as the old AND array did: the cursor pages within the filtered list rather than cancelling a filter out.
	let filtered = db.orm.public.ThemeProject.where({ deletedAt: null }).orderBy([
		project => project.updatedAt.desc(),
		project => project.id.desc(),
	])
	if (!opts.unstarted) filtered = filtered.where(project => project.namedAt.isNotNull())
	if (opts.theme) filtered = filtered.where({ theme: opts.theme })
	if (opts.designStatus) filtered = filtered.where({ designStatus: opts.designStatus })
	if (opts.buildStatus) filtered = filtered.where({ buildStatus: opts.buildStatus })
	if (q) {
		const pattern = containsPattern(q)
		filtered = filtered.where(project =>
			or(
				project.id.eq(q),
				project.title.ilike(pattern),
				project.description.ilike(pattern),
				project.githubRepo.ilike(pattern),
				// The owner's email and Slack id are contact details, so they are matched only for a caller who may see them. A REVIEWER searching for an address gets the same answer whether or not it is registered here.
				project.user.some(user =>
					includePii
						? or(
								user.name.ilike(pattern),
								user.displayName.ilike(pattern),
								user.email.ilike(pattern),
								user.slackId.ilike(pattern),
							)
						: or(user.name.ilike(pattern), user.displayName.ilike(pattern)),
				),
			),
		)
	}
	if (opts.extended)
		filtered = filtered.where(project =>
			or(
				project.submissionExtensionUntil.gt(nowText),
				project.user.some(user => user.submissionExtensionUntil.gt(nowText)),
			),
		)
	if (tier !== undefined)
		filtered = filtered.where(project =>
			or(project.tier.eq(tier), and(project.requestedTier.eq(tier), project.tier.isNull())),
		)
	const position = readCursor(opts.cursor)
	// The directory is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged =
		position?.at === undefined || position?.at === null
			? filtered
			: filtered.cursor({ id: position.id, updatedAt: formatDbTimestamp(position.at) })
	const rows = await paged
		.limit(opts.limit + 1)
		.select(
			"buildStatus",
			"designStatus",
			"githubRepo",
			"id",
			"requestedTier",
			"submissionExtensionUntil",
			"theme",
			"tier",
			"title",
			"updatedAt",
		)
		.include("user", user => user.select("displayName", "email", "id", "name", "slackId", "submissionExtensionUntil"))
		.all()
	const items = rows.slice(0, opts.limit).map(row => {
		// The foreign key is required, so a missing owner is a data-integrity error rather than a row to render without one.
		if (!row.user) throw new Error(`project ${row.id} has no owner`)
		return {
			buildStatus: row.buildStatus,
			designStatus: row.designStatus,
			githubRepo: row.githubRepo,
			id: row.id,
			requestedTier: row.requestedTier,
			submissionExtensionUntil:
				row.submissionExtensionUntil === null ? null : parseDbTimestamp(row.submissionExtensionUntil),
			theme: row.theme,
			tier: row.tier,
			title: row.title,
			updatedAt: parseDbTimestamp(row.updatedAt),
			user: {
				displayName: row.user.displayName,
				email: row.user.email,
				id: row.user.id,
				name: row.user.name,
				slackId: row.user.slackId,
				submissionExtensionUntil:
					row.user.submissionExtensionUntil === null ? null : parseDbTimestamp(row.user.submissionExtensionUntil),
			},
		}
	})
	const last = items.at(-1)
	// The same rule as the user directory: the owner's contact details leave the server for ADMIN/AUDITOR only. A REVIEWER/FULFILLER gets names and roles, with no email or Slack id to scrape.
	return {
		items: includePii
			? items
			: items.map(row => Object.assign(row, { user: Object.assign(row.user, { email: "", slackId: null }) })),
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.updatedAt, id: last.id }) : null,
	}
}

/** The admin user profile: the selected columns plus money sections both branches fill. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface UserDetail {
	createdAt: Date
	displayName: string | null
	email: string
	fraudFlagged: boolean
	hackatimeUserId: string | null
	id: string
	joinedProgramAt: Date | null
	name: string | null
	printerAward: {
		addressLockedAt: Date | null
		deliveredAt: Date | null
		id: string
		qualifiedAt: Date
		revokedAt: Date | null
		revokedReason: string | null
		shippedAt: Date | null
		status: Models.public_PrinterAward["status"]
		trackingCarrier: string | null
		trackingNumber: string | null
	} | null
	roles: { grantedAt: string; grantedBy: string | null; role: Models.public_UserRole["role"] }[]
	slackDisplayName: string | null
	slackId: string | null
	submissionExtensionUntil: Date | null
	themeProjects: {
		approvedHours: number | null
		buildCoins: number | null
		buildStatus: Models.public_ThemeProject["buildStatus"]
		designBankedCoins: number | null
		designSpendableCoins: number | null
		designStatus: Models.public_ThemeProject["designStatus"]
		grantUsd: number | null
		hcbGrantTopUps: { id: string }[]
		id: string
		submissionExtensionUntil: Date | null
		theme: Models.public_ThemeProject["theme"]
		tier: number | null
		title: string
	}[]
	verificationStatus: string | null
}

/** The 25 most recent orders on the user page: number, item, credit total and status only. */
export interface UserDetailOrder {
	id: string
	itemNameSnapshot: string
	orderNumber: number
	status: Models.public_ShopOrder["status"]
	totalCredits: number
}

export async function getUserDetail(
	userId: string,
	flags?: { includeSensitive?: boolean },
): Promise<{
	user: UserDetail
	balances: Balances
	ledger: LedgerEntryRow[]
	orders: UserDetailOrder[]
	printer: PrinterQualification
} | null> {
	const includeSensitive = flags?.includeSensitive ?? false
	const row = await db.orm.public.User.whereUnique({ id: userId })
		.select(
			"createdAt",
			"displayName",
			"email",
			"fraudFlagged",
			"hackatimeUserId",
			"id",
			"joinedProgramAt",
			"name",
			"slackDisplayName",
			"slackId",
			"submissionExtensionUntil",
			"verificationStatus",
		)
		.include("printerAward", award =>
			award.select(
				"addressLockedAt",
				"deliveredAt",
				"id",
				"qualifiedAt",
				"revokedAt",
				"revokedReason",
				"shippedAt",
				"status",
				"trackingCarrier",
				"trackingNumber",
			),
		)
		.include("roles", roles => roles.select("grantedAt", "grantedBy", "role"))
		.include("themeProjects", projects =>
			projects
				.select(
					"approvedHours",
					"buildCoins",
					"buildStatus",
					"designBankedCoins",
					"designSpendableCoins",
					"designStatus",
					"grantUsd",
					"id",
					"submissionExtensionUntil",
					"theme",
					"tier",
					"title",
				)
				.where({ deletedAt: null })
				.include("hcbGrantTopUps", topUps =>
					topUps
						.select("id")
						.where({ phase: "DESIGN" })
						.where(topUp => topUp.sentAt.isNotNull()),
				),
		)
		.first()
	if (!row) return null
	const parseNullable = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))
	const user: UserDetail = {
		createdAt: parseDbTimestamp(row.createdAt),
		displayName: row.displayName,
		email: row.email,
		fraudFlagged: row.fraudFlagged,
		hackatimeUserId: row.hackatimeUserId,
		id: row.id,
		joinedProgramAt: parseNullable(row.joinedProgramAt),
		name: row.name,
		printerAward: row.printerAward
			? {
					...row.printerAward,
					addressLockedAt: parseNullable(row.printerAward.addressLockedAt),
					deliveredAt: parseNullable(row.printerAward.deliveredAt),
					qualifiedAt: parseDbTimestamp(row.printerAward.qualifiedAt),
					revokedAt: parseNullable(row.printerAward.revokedAt),
					shippedAt: parseNullable(row.printerAward.shippedAt),
				}
			: null,
		roles: row.roles,
		slackDisplayName: row.slackDisplayName,
		slackId: row.slackId,
		submissionExtensionUntil: parseNullable(row.submissionExtensionUntil),
		themeProjects: row.themeProjects.map(project => ({
			...project,
			submissionExtensionUntil: parseNullable(project.submissionExtensionUntil),
		})),
		verificationStatus: row.verificationStatus,
	}

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

	const [balances, ledgerRows, orders, printer] = await Promise.all([
		db.transaction(tx => getBalances(tx, userId)),
		db.orm.public.LedgerEntry.where({ userId })
			.orderBy([entry => entry.createdAt.desc(), entry => entry.id.desc()])
			.limit(50)
			.all(),
		db.orm.public.ShopOrder.where({ userId })
			.orderBy(order => order.placedAt.desc())
			// The user page lists the number, item, credit total and status only; internal cost and encrypted columns are not part of VIEW_USERS.
			.select("id", "itemNameSnapshot", "orderNumber", "status", "totalCredits")
			.limit(25)
			.all(),
		getPrinterQualification(userId),
	])

	const ledger: LedgerEntryRow[] = ledgerRows.map(entry =>
		withFields(entry, { createdAt: parseDbTimestamp(entry.createdAt) }),
	)
	return { balances, ledger, orders, printer, user }
}

/** One row of the admin order directory: the staff-safe columns plus buyer and item names. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns, so the API's JSON keeps its ISO shapes. */
export interface OrderDirectoryRow {
	fulfilledAt: Date | null
	fulfillmentMethod: Models.public_ShopOrder["fulfillmentMethod"]
	fulfillmentStage: Models.public_ShopOrder["fulfillmentStage"]
	fulfillmentUpdatedAt: Date | null
	heldAt: Date | null
	holdReason: string | null
	id: string
	itemNameSnapshot: string
	notes: { authorId: string; body: string; createdAt: Date }[]
	orderNumber: number
	placedAt: Date
	quantity: number
	rejectedAt: Date | null
	rejectionReason: string | null
	shopItem: { id: string; name: string }
	shopItemId: string
	status: Models.public_ShopOrder["status"]
	totalCredits: number
	trackingCarrier: string | null
	trackingNumber: string | null
	unitCostUsd: number | null
	unitCredits: number
	user: { displayName: string | null; id: string; name: string | null }
	userId: string
}

export async function listOrders(opts: {
	status?: ShopOrderStatus
	cursor?: string
	limit: number
}): Promise<{ items: OrderDirectoryRow[]; nextCursor: string | null }> {
	const filtered = db.orm.public.ShopOrder.where(opts.status ? { status: opts.status } : {}).orderBy([
		order => order.placedAt.desc(),
		order => order.id.desc(),
	])
	// Only the API reads this list, so a cursor that is not one of ours is a bad request rather than a page to fall back to.
	const position = opts.cursor === undefined ? null : decodeCursor(opts.cursor)
	// Explicit select, not a whole row: a whole-row response would carry the encrypted address/phone and `lastActorId` this API has no use for.
	const paged = position?.at ? filtered.cursor({ id: position.id, placedAt: formatDbTimestamp(position.at) }) : filtered
	const rows = await paged
		.limit(opts.limit + 1)
		.select(
			"fulfilledAt",
			"fulfillmentMethod",
			"fulfillmentStage",
			"fulfillmentUpdatedAt",
			"heldAt",
			"holdReason",
			"id",
			"itemNameSnapshot",
			"orderNumber",
			"placedAt",
			"quantity",
			"rejectedAt",
			"rejectionReason",
			"shopItemId",
			"status",
			"totalCredits",
			"trackingCarrier",
			"trackingNumber",
			"unitCostUsd",
			"unitCredits",
			"userId",
		)
		.include("notes", notes => notes.select("authorId", "body", "createdAt"))
		.include("shopItem", item => item.select("id", "name"))
		.include("user", user => user.select("displayName", "id", "name"))
		.all()
	const items = rows.slice(0, opts.limit).map(row => {
		if (!row.shopItem) throw new Error(`order ${row.id} has no item`)
		if (!row.user) throw new Error(`order ${row.id} has no buyer`)
		return {
			fulfilledAt: row.fulfilledAt === null ? null : parseDbTimestamp(row.fulfilledAt),
			fulfillmentMethod: row.fulfillmentMethod,
			fulfillmentStage: row.fulfillmentStage,
			fulfillmentUpdatedAt: row.fulfillmentUpdatedAt === null ? null : parseDbTimestamp(row.fulfillmentUpdatedAt),
			heldAt: row.heldAt === null ? null : parseDbTimestamp(row.heldAt),
			holdReason: row.holdReason,
			id: row.id,
			itemNameSnapshot: row.itemNameSnapshot,
			notes: row.notes.map(note => ({
				authorId: note.authorId,
				body: note.body,
				createdAt: parseDbTimestamp(note.createdAt),
			})),
			orderNumber: row.orderNumber,
			placedAt: parseDbTimestamp(row.placedAt),
			quantity: row.quantity,
			rejectedAt: row.rejectedAt === null ? null : parseDbTimestamp(row.rejectedAt),
			rejectionReason: row.rejectionReason,
			shopItem: row.shopItem,
			shopItemId: row.shopItemId,
			status: row.status,
			totalCredits: row.totalCredits,
			trackingCarrier: row.trackingCarrier,
			trackingNumber: row.trackingNumber,
			unitCostUsd: row.unitCostUsd,
			unitCredits: row.unitCredits,
			user: row.user,
			userId: row.userId,
		}
	})
	const last = items.at(-1)
	return {
		items,
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.placedAt, id: last.id }) : null,
	}
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
	cancellationReason: string | null
	cancelledAt: Date | null
	country: string | null
	fulfilledAt: Date | null
	fulfillmentMethod: ShopFulfillmentMethod | null
	fulfillmentStage: ShopFulfillmentStage
	holdReason: string | null
	id: string
	itemNameSnapshot: string
	orderNumber: number
	placedAt: Date
	quantity: number
	rejectionReason: string | null
	status: ShopOrderStatus
	totalUsd: number | null
	trackingCarrier: string | null
	trackingNumber: string | null
	user: { id: string; name: string | null }
}

/** One row as it comes out of the database, before the sheet's own arithmetic. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface FulfillmentOrderModel {
	cancellationReason: string | null
	cancelledAt: string | null
	fulfilledAt: string | null
	fulfillmentMethod: Models.public_ShopOrder["fulfillmentMethod"]
	fulfillmentStage: Models.public_ShopOrder["fulfillmentStage"]
	holdReason: string | null
	id: string
	itemNameSnapshot: string
	orderNumber: number
	placedAt: Date
	quantity: number
	rejectionReason: string | null
	shopItem: { costUsd: number | null }
	status: Models.public_ShopOrder["status"]
	trackingCarrier: string | null
	trackingNumber: string | null
	unitCostUsd: number | null
	user: { displayName: string | null; encryptedAddressCountry: string | null; id: string; name: string | null }
}

export async function listFulfillmentOrders(
	filters: FulfillmentFilters,
	opts: { cursor?: string; limit: number },
): Promise<{ items: FulfillmentOrderRow[]; nextCursor: string | null }> {
	// Every filter ANDs, as the old AND array did: the cursor pages within the filtered list rather than cancelling a filter out.
	const { method, placedBefore, placedFrom, stage } = filters
	let filtered = db.orm.public.ShopOrder.where(order => order.status.in(FULFILLMENT_ORDER_STATUSES)).orderBy([
		order => order.placedAt.desc(),
		order => order.id.desc(),
	])
	if (placedFrom || placedBefore)
		filtered = filtered.where(order =>
			and(
				...(placedFrom ? [order.placedAt.gte(formatDbTimestamp(placedFrom))] : []),
				...(placedBefore ? [order.placedAt.lt(formatDbTimestamp(placedBefore))] : []),
			),
		)
	if (method === "NONE") filtered = filtered.where(order => order.fulfillmentMethod.isNull())
	else if (method) filtered = filtered.where({ fulfillmentMethod: method })
	if (stage)
		filtered = filtered.where(order =>
			// A cancelled order shows as cancelled, so it matches no other stage.
			stage === ShopFulfillmentStage.CANCELLED
				? or(order.status.eq(ShopOrderStatus.CANCELLED), order.fulfillmentStage.eq(ShopFulfillmentStage.CANCELLED))
				: and(order.fulfillmentStage.eq(stage), order.status.neq(ShopOrderStatus.CANCELLED)),
		)
	const position = readCursor(opts.cursor)
	// The sheet is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged =
		position?.at === undefined || position?.at === null
			? filtered
			: filtered.cursor({ id: position.id, placedAt: formatDbTimestamp(position.at) })
	const rows = await paged
		.limit(opts.limit + 1)
		.select(
			"cancellationReason",
			"cancelledAt",
			"fulfilledAt",
			"fulfillmentMethod",
			"fulfillmentStage",
			"holdReason",
			"id",
			"itemNameSnapshot",
			"orderNumber",
			"placedAt",
			"quantity",
			"rejectionReason",
			"status",
			"trackingCarrier",
			"trackingNumber",
			"unitCostUsd",
		)
		.include("shopItem", item => item.select("costUsd"))
		.include("user", user => user.select("displayName", "encryptedAddressCountry", "id", "name"))
		.all()
	const models = rows.slice(0, opts.limit).map(row => {
		if (!row.shopItem) throw new Error(`order ${row.id} has no item`)
		if (!row.user) throw new Error(`order ${row.id} has no buyer`)
		return {
			cancellationReason: row.cancellationReason,
			cancelledAt: row.cancelledAt,
			fulfilledAt: row.fulfilledAt,
			fulfillmentMethod: row.fulfillmentMethod,
			fulfillmentStage: row.fulfillmentStage,
			holdReason: row.holdReason,
			id: row.id,
			itemNameSnapshot: row.itemNameSnapshot,
			orderNumber: row.orderNumber,
			placedAt: parseDbTimestamp(row.placedAt),
			quantity: row.quantity,
			rejectionReason: row.rejectionReason,
			shopItem: row.shopItem,
			status: row.status,
			trackingCarrier: row.trackingCarrier,
			trackingNumber: row.trackingNumber,
			unitCostUsd: row.unitCostUsd,
			user: row.user,
		}
	})
	const last = models.at(-1)

	const items = models.map(({ shopItem, user, unitCostUsd, ...order }) => {
		// Orders from before the item had a cost fall back to today's.
		const unit = unitCostUsd ?? shopItem.costUsd
		return Object.assign(order, {
			cancelledAt: order.cancelledAt === null ? null : parseDbTimestamp(order.cancelledAt),
			country: safeDecrypt(user.encryptedAddressCountry),
			fulfilledAt: order.fulfilledAt === null ? null : parseDbTimestamp(order.fulfilledAt),
			fulfillmentStage: fulfillmentStageOf(order),
			totalUsd: unit === null ? null : unit * order.quantity,
			user: { id: user.id, name: displayName(user) },
		})
	})
	return {
		items,
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.placedAt, id: last.id }) : null,
	}
}

/** True for one of the recorded action names. Guards the audit-log filter. */
export function isAuditAction(value: string): value is AuditAction {
	return (Object.values(AuditAction) as string[]).includes(value)
}

/** One row of the audit log as Prisma 8 reads it. Its timestamps are PostgreSQL text, not Dates. */
export type AuditLogRow = Models.public_AuditLog

export async function listAuditLog(opts: {
	action?: string
	targetId?: string
	cursor?: string
	limit: number
}): Promise<{ items: AuditLogRow[]; nextCursor: string | null }> {
	const position = readCursor(opts.cursor)
	const base = db.orm.public.AuditLog.where({
		// The page's filter box takes free text, so an unrecognised action is treated as no filter rather than a Prisma enum error; the API route rejects it properly with a 400.
		...(opts.action && isAuditAction(opts.action) ? { action: opts.action } : {}),
		...(opts.targetId ? { targetId: opts.targetId } : {}),
	}).orderBy([entry => entry.createdAt.desc(), entry => entry.id.desc()])
	// The log is rendered as a page as well as served as an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const rows = position?.at
		? await base
				.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
				.limit(opts.limit + 1)
				.all()
		: await base.limit(opts.limit + 1).all()
	const items = rows.slice(0, opts.limit)
	const last = items.at(-1)
	return {
		items,
		nextCursor:
			rows.length > opts.limit && last ? encodeCursor({ at: parseDbTimestamp(last.createdAt), id: last.id }) : null,
	}
}

/**
 * Awards to ship, newest qualification first. `encryptedAddress` is read only to answer "is an address locked on file"; the ciphertext never leaves the server.
 */
/** Printer awards with the ciphertext folded into an on-file flag. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface PrinterAwardRow {
	addressLockedAt: Date | null
	addressOnFile: boolean
	deliveredAt: Date | null
	id: string
	qualifiedAt: Date
	revokedAt: Date | null
	revokedReason: string | null
	shippedAt: Date | null
	status: Models.public_PrinterAward["status"]
	trackingCarrier: string | null
	trackingNumber: string | null
	user: { displayName: string | null; id: string; name: string | null }
}

export async function listPrinterAwards(limit = 100): Promise<PrinterAwardRow[]> {
	const rows = await db.orm.public.PrinterAward.orderBy(award => award.qualifiedAt.desc())
		.limit(limit)
		.select(
			"addressLockedAt",
			"deliveredAt",
			"encryptedAddress",
			"id",
			"qualifiedAt",
			"revokedAt",
			"revokedReason",
			"shippedAt",
			"status",
			"trackingCarrier",
			"trackingNumber",
		)
		.include("user", user => user.select("displayName", "id", "name"))
		.all()
	return rows.map(({ encryptedAddress, user, ...award }) => {
		if (!user) throw new Error(`printer award ${award.id} has no user`)
		return Object.assign(award, {
			addressLockedAt: award.addressLockedAt === null ? null : parseDbTimestamp(award.addressLockedAt),
			addressOnFile: encryptedAddress !== "",
			deliveredAt: award.deliveredAt === null ? null : parseDbTimestamp(award.deliveredAt),
			qualifiedAt: parseDbTimestamp(award.qualifiedAt),
			revokedAt: award.revokedAt === null ? null : parseDbTimestamp(award.revokedAt),
			shippedAt: award.shippedAt === null ? null : parseDbTimestamp(award.shippedAt),
			user,
		})
	})
}

/** Recent live reels, newest first, for the moderation panel. */
/** One row of the listRecentPostsForModeration list. */
export interface ModeratedPost {
	caption: string
	createdAt: Date
	hiddenAt: Date | null
	hiddenReason: string | null
	id: string
	kind: Models.public_Post["kind"]
	publishedAt: Date | null
	themeProject: { id: string; title: string } | null
	user: { displayName: string | null; email: string; id: string; name: string | null }
}

export async function listRecentPostsForModeration(limit = 25): Promise<ModeratedPost[]> {
	const rows = await db.orm.public.Post.where({ deletedAt: null })
		.orderBy([post => post.publishedAt.desc(), post => post.id.desc()])
		.limit(limit)
		.select("caption", "createdAt", "hiddenAt", "hiddenReason", "id", "kind", "publishedAt")
		.include("themeProject", project => project.select("id", "title"))
		.include("user", user => user.select("displayName", "email", "id", "name"))
		.all()
	return rows.map(post => {
		// The foreign key is required, so a missing user is a data-integrity error rather than a row to render without an author.
		if (!post.user) throw new Error(`post ${post.id} has no author`)
		return {
			caption: post.caption,
			createdAt: parseDbTimestamp(post.createdAt),
			hiddenAt: post.hiddenAt === null ? null : parseDbTimestamp(post.hiddenAt),
			hiddenReason: post.hiddenReason,
			id: post.id,
			kind: post.kind,
			publishedAt: post.publishedAt === null ? null : parseDbTimestamp(post.publishedAt),
			themeProject: post.themeProject,
			user: post.user,
		}
	})
}

/**
 * Recent live comments, newest first. A comment on a soft-deleted post is not shown – nobody can reach it to report it – but a hidden comment stays in the list so staff can see it was handled.
 */
/** One row of the listRecentCommentsForModeration list. */
export interface ModeratedComment {
	body: string
	createdAt: Date
	hiddenAt: Date | null
	hiddenReason: string | null
	id: string
	post: { caption: string; id: string }
	user: { displayName: string | null; email: string; id: string; name: string | null }
}

export async function listRecentCommentsForModeration(limit = 25): Promise<ModeratedComment[]> {
	const rows = await db.orm.public.PostComment.where({ deletedAt: null })
		.where(comment => comment.post.some(post => post.deletedAt.isNull()))
		.orderBy([comment => comment.createdAt.desc(), comment => comment.id.desc()])
		.limit(limit)
		.select("body", "createdAt", "hiddenAt", "hiddenReason", "id")
		.include("post", post => post.select("caption", "id"))
		.include("user", user => user.select("displayName", "email", "id", "name"))
		.all()
	return rows.map(comment => {
		if (!comment.post) throw new Error(`comment ${comment.id} has no post`)
		if (!comment.user) throw new Error(`comment ${comment.id} has no author`)
		return {
			body: comment.body,
			createdAt: parseDbTimestamp(comment.createdAt),
			hiddenAt: comment.hiddenAt === null ? null : parseDbTimestamp(comment.hiddenAt),
			hiddenReason: comment.hiddenReason,
			id: comment.id,
			post: comment.post,
			user: comment.user,
		}
	})
}

/** Public reel links, newest first, so staff can find a post that went viral. */
/** One row of the public-reel directory. */
export interface PublicReelRow {
	email: string | null
	id: string
	platform: Models.public_PublicReel["platform"]
	post: { caption: string; id: string } | null
	postedAt: Date
	themeProject: { id: string; title: string } | null
	url: string
	user: { displayName: string | null; id: string; name: string | null }
}

export async function listRecentPublicReels(limit = 100): Promise<PublicReelRow[]> {
	const rows = await db.orm.public.PublicReel.orderBy([reel => reel.postedAt.desc(), reel => reel.id.desc()])
		.limit(limit)
		.select("email", "id", "platform", "postedAt", "url")
		.include("post", post => post.select("caption", "id"))
		.include("themeProject", project => project.select("id", "title"))
		.include("user", user => user.select("displayName", "id", "name"))
		.all()
	return rows.map(reel => {
		if (!reel.user) throw new Error(`public reel ${reel.id} has no user`)
		return {
			email: reel.email,
			id: reel.id,
			platform: reel.platform,
			post: reel.post,
			postedAt: parseDbTimestamp(reel.postedAt),
			themeProject: reel.themeProject,
			url: reel.url,
			user: reel.user,
		}
	})
}

export async function getAdminCounters(): Promise<{
	pendingReviews: number
	pendingReviewsUnsent: number
	pendingOrders: number
	participants: number
	shipped: number
}> {
	// The open hand-ins, each phase's newest only: an older unresolved row is a ship Ari no longer holds, and counting it would put a hand-in in the queue that no reviewer can open. The same rule as the reviewer-activity ring, so the two figures on the page cannot disagree.
	const open = await db.orm.public.PhaseSubmission.where({ resolvedAt: null })
		.select("ariSubmissionId", "createdAt", "id", "phase", "themeProjectId")
		.include("themeProject", project => project.select("buildStatus", "designStatus"))
		.all()
	const ships = countAriShips(
		open.map(submission => {
			if (!submission.themeProject) throw new Error(`submission ${submission.id} has no project`)
			return {
				ariSubmissionId: submission.ariSubmissionId,
				createdAt: parseDbTimestamp(submission.createdAt),
				id: submission.id,
				phase: submission.phase,
				phaseStatus:
					submission.phase === Phase.DESIGN
						? submission.themeProject.designStatus
						: submission.themeProject.buildStatus,
				resolvedAt: null,
				result: null,
				themeProjectId: submission.themeProjectId,
			}
		}),
	)

	const [pendingOrders, participants, shipped] = await Promise.all([
		db.orm.public.ShopOrder.where({ status: ShopOrderStatus.PENDING }).aggregate(a => ({ count: a.count() })),
		db.orm.public.User.aggregate(a => ({ count: a.count() })),
		db.orm.public.PrinterAward.where(award => award.revokedAt.isNull()).aggregate(a => ({ count: a.count() })),
	])
	// Sent, and Ari holds it: the figure comparable to Ari's own pending count. `ariSubmissionId` is the marker rather than `ariStatus`, which only a decision or a reset ever writes and so says nothing about a ship nobody has opened yet.
	const pendingReviews = ships.pending
	// Never reached Ari: the send failed and the retry has not got it through yet. Counted apart because folding it in is how this panel's "awaiting review" drifted hundreds above the queue reviewers actually had – a hand-in Ari has never seen is not waiting for review, it is waiting for us.
	const pendingReviewsUnsent = ships.unreached
	return {
		participants: participants.count,
		pendingOrders: pendingOrders.count,
		pendingReviews,
		pendingReviewsUnsent,
		shipped: shipped.count,
	}
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
 * Steps with a named marker come from User (lib/analytics); "named a project" and the repo/devlog steps are derived from their own tables; "repo checks passed" is stamped by the submit path, where the checks that gate a submission came back green. The onboarding and goal steps in between are derived as noted below.
 *
 * The three reel steps that used to sit here ("started a reel upload", "uploaded a reel", "posted a reel") are gone. A funnel can only draw one spine, so putting reel posting on it said every maker who did not post a reel had dropped out, when a maker who is quietly journalling and building has not. Reel posting is one branch of the journey rather than a rung on it, and a branch is what the Sankey view draws: it can show a maker who added a devlog and posted a reel in either order, which a top-to-bottom funnel cannot represent at all.
 *
 * `posted` survives as a history guard on the onboarding and goal steps even now its own row is gone: the goal prompt shipped after the first reels, so "finished onboarding" and "set a goal" each mean "did this OR already did something later that presupposes it". Without the fallback, backfilling either column would silently shrink every step beneath it instead of showing a real drop.
 *
 * The tracked-time rows that used to end this funnel ("Hackatimed", "Lapsed", "Devlogged") are gone, and two queries with them. Counted on a cumulative spine they asked a question the spine cannot answer: "of the people who got this far, how many have a Hackatime link" reads a maker who journals competently and never links Hackatime as a drop-off, when they did not drop out of anything – they took a different route through the same week. Activity is a set of branches rather than rungs, and branches are what the Sankey view draws: there they sit in one activity stage as ribbons of whatever width they really are, in any order, which is the only shape that can show a maker who both journalled and linked Hackatime. One fact, drawn once, rather than drawn twice in two shapes that disagree.
 */
export async function getUserFlowFunnel(): Promise<FlowStep[]> {
	const [users, sessionUsers, projectUsers, devlogUsers, repoUsers] = await Promise.all([
		db.orm.public.User.select(
			"firstChecksPassedAt",
			"firstProjectAt",
			"firstReelAt",
			"firstSubmissionAt",
			"hardwareExperience",
			"id",
			"onboardingCompletedAt",
			"onboardingStep",
			"participantGoal",
		).all(),
		// People who logged in: a sign-in is what issues a session. Derived from the table rather than the lastLoginAt marker, so the funnel does not depend on the analytics backfill having run.
		db.orm.public.Session.distinct("userId").select("userId").all(),
		// The onboarding paper trail, per person, read off their live projects: a description means they named something, a starter means they took one of the catalogue's, and a requested tier means they answered the tier question. One read for all three because the funnel needs them together.
		db.orm.public.ThemeProject.where({ deletedAt: null })
			.select("description", "requestedTier", "starterProjectId", "userId")
			.all(),
		// People who added a devlog: a project with a real work session on it.
		db.orm.public.User.where(user =>
			user.themeProjects.some(project =>
				and(
					project.deletedAt.isNull(),
					project.workSessions.some(session =>
						and(
							session.deletedAt.isNull(),
							or(
								session.hoursSource.neq(HoursSource.HACKATIME_TRACKED),
								// Same rule as the Loops lastEntryAt sync: a real entry is a session the maker wrote, or one carrying a timelapse. A HACKATIME_TRACKED row with no timelapse is only a link, not a devlog.
								session.timelapses.some(),
							),
						),
					),
				),
			),
		)
			.select("id")
			.all(),
		// People who connected a repository to a project.
		db.orm.public.ThemeProject.where({ deletedAt: null })
			.where(project =>
				or(project.githubRepo.isNotNull(), project.repoSyncRepo.isNotNull(), project.repoSyncEnabled.eq(true)),
			)
			.distinct("userId")
			.select("userId")
			.all(),
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
		{
			hint: "Every submission met the repo checks (a Displays project may waive firmware by confirming no microcontroller)",
			id: "checksPassed",
			label: "Repo checks passed",
		},
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

export interface WeekFlowStep {
	/** Distinct people who handed in a project for this week. */
	count: number
	/** What the week's project is, e.g. "PCBs · design week". */
	hint: string
	label: string
	/** Share of everyone signed up who handed in this week's project. */
	ofSignupsPct: number
	week: number
}

/**
 * The season week by week: how many people handed in each week's project, for the weeks that have opened.
 *
 * "This week's project" is the theme and phase the schedule puts in that week, not the week a hand-in happened to land in – a maker who hands week 2's design in during week 4 still belongs to week 2, which is the week the work was for. Any hand-in counts, in review, approved or sent back, because all three say the maker put the work in; a week taken back has had its open row deleted, so it stops counting. Rows from before `scheduledWeek` was recorded fall back to the theme and phase's own week, the same rule the Loops sync resolves a submission by.
 *
 * Only weeks that have opened are returned. A week still in the future has no submitters because nobody could hand in yet, which is not the same finding as a week nobody handed in for, and drawing it as a zero would read as the latter.
 *
 * The count is people, not hand-ins: a maker who handed in both the design and the build for a week is one person on that week's row.
 */
export async function getUserFlowWeekly(): Promise<WeekFlowStep[]> {
	const settings = await getProgramSettings()
	const openWeeks = Math.min(
		TOTAL_WEEKS,
		weekNumberForDate(settings.eventStartDate, new Date(), settings.programTimezone),
	)
	if (openWeeks < 1) return []

	const [signups, submissions] = await Promise.all([
		db.orm.public.User.aggregate(a => ({ count: a.count() })),
		db.orm.public.PhaseSubmission.where(submission =>
			or(
				and(submission.scheduledWeek.gte(1), submission.scheduledWeek.lte(openWeeks)),
				submission.scheduledWeek.isNull(),
			),
		)
			// Null rows are kept because a hand-in from before `scheduledWeek` was recorded only finds its week through its theme and phase below.
			.where(submission => submission.themeProject.some(project => project.deletedAt.isNull()))
			.select("id", "phase", "scheduledWeek")
			.include("themeProject", project => project.select("theme", "userId"))
			.all(),
	])

	const submitters = new Map<number, Set<string>>()
	for (const submission of submissions) {
		if (!submission.themeProject) throw new Error(`submission ${submission.id} has no project`)
		const week = submission.scheduledWeek ?? scheduledWeekFor(submission.themeProject.theme, submission.phase)
		if (week < 1 || week > openWeeks) continue
		const seen = submitters.get(week) ?? new Set<string>()
		seen.add(submission.themeProject.userId)
		submitters.set(week, seen)
	}

	return Array.from({ length: openWeeks }, (_, i) => {
		const week = i + 1
		const scheduled = scheduleForWeek(week)
		const count = submitters.get(week)?.size ?? 0
		return {
			count,
			hint: scheduled
				? `${scheduled.theme.label} · ${scheduled.phase === Phase.DESIGN ? "design" : "build"} week`
				: "No theme scheduled",
			label: `Week ${week}`,
			ofSignupsPct: pctOf(count, signups.count),
			week,
		}
	})
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
	const position = readCursor(opts.cursor)
	const ordered = db.orm.public.ContentReport.where(status === "ALL" ? {} : { status }).orderBy([
		report => report.createdAt.desc(),
		report => report.id.desc(),
	])
	// The queue is a page rather than an API, so a cursor that has been hand-edited starts the list again rather than failing: a mistyped link is not a server error.
	const paged = position?.at ? ordered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id }) : ordered
	const rows = await paged
		.limit(limit + 1)
		.select("createdAt", "details", "id", "reason", "resolvedAt", "resolvedById", "status", "target")
		.include("comment", comment =>
			comment
				.select("body", "deletedAt", "hiddenAt", "id", "postId")
				.include("user", user => user.select("displayName", "id", "name")),
		)
		.include("post", post =>
			post
				.select("caption", "deletedAt", "hiddenAt", "id")
				.include("user", user => user.select("displayName", "id", "name")),
		)
		.include("reporter", reporter => reporter.select("displayName", "email", "id", "name"))
		.include("themeProject", project =>
			project.select("deletedAt", "id", "title").include("user", user => user.select("displayName", "id", "name")),
		)
		.include("workSession", session =>
			session
				.select("content", "deletedAt", "id", "title")
				.include("themeProject", project =>
					project.select("id", "title").include("user", user => user.select("displayName", "id", "name")),
				),
		)
		.include("targetUser", user => user.select("displayName", "id", "name"))
		.all()
	const items = rows.slice(0, limit)
	const last = items.at(-1)
	return {
		items,
		nextCursor:
			rows.length > limit && last ? encodeCursor({ at: parseDbTimestamp(last.createdAt), id: last.id }) : null,
	}
}

/** One row of the content-report directory, with every reportable target attached. */
export type ContentReportRow = Awaited<ReturnType<typeof listContentReports>>["items"][number]

export async function countContentReports(): Promise<Record<ReportStatus, number>> {
	const groups = await db.orm.public.ContentReport.groupBy("status").aggregate(group => ({ count: group.count() }))
	const counts: Record<ReportStatus, number> = { DISMISSED: 0, OPEN: 0, RESOLVED: 0 }
	for (const group of groups) counts[group.status] = group.count
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
		db.orm.public.User.select("id", "timezone").all(),
		db.orm.public.WorkSession.where({ deletedAt: null })
			.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
			.select("hoursApproved", "hoursClaimed", "hoursSource", "id", "phase", "themeProjectId")
			.include("themeProject", project => project.select("userId"))
			.include("timelapses", timelapse => timelapse.select("coveredSeconds", "hackatimeProject", "recordedAt"))
			.all(),
		db.orm.public.HackatimeLink.where(link => link.themeProject.some(project => project.deletedAt.isNull()))
			.select("cachedSeconds", "cachedSpans", "hackatimeProject", "hoursApproved", "id", "phase", "themeProjectId")
			.include("themeProject", project => project.select("userId"))
			.all(),
	])
	return {
		links: links.map(link => {
			const { themeProject } = link
			if (!themeProject) throw new Error(`hackatime link ${link.id} has no project`)
			return withFields(link, { themeProject })
		}),
		sessions: sessions.map(session => {
			const { themeProject } = session
			if (!themeProject) throw new Error(`session ${session.id} has no project`)
			return withFields(session, {
				themeProject,
				timelapses: session.timelapses.map(timelapse =>
					withFields(timelapse, {
						recordedAt: timelapse.recordedAt === null ? null : parseDbTimestamp(timelapse.recordedAt),
					}),
				),
			})
		}),
		users,
	}
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
	const sessions = await db.orm.public.WorkSession.where({ deletedAt: null })
		.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
		.select("effectiveDate", "hoursApproved", "hoursClaimed", "hoursSource", "id")
		// A session belongs to the project, not the person, so the user is reached through it.
		.include("themeProject", project => project.select("userId"))
		.all()

	const byDay = new Map<string, { devlogs: number; hours: number; users: Set<string> }>()
	for (const s of sessions) {
		if (!s.themeProject) throw new Error(`session ${s.id} has no project`)
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
	const [first] = days
	const last = days.at(-1)
	if (first === undefined || last === undefined) return []
	const out: DayActivity[] = []
	for (const day of eachDayBetween(first, last)) {
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

	const sessions = await db.orm.public.WorkSession.where({ deletedAt: null })
		.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
		.select("createdAt", "effectiveDate", "hoursClaimed", "id")
		// A session belongs to the project, not the person, so the user is reached through it.
		.include("themeProject", project => project.select("userId"))
		.all()

	// day → (user → that person's hours that day), so the threshold is applied to a whole day rather than one entry.
	const totals = new Map<string, Map<string, number>>()
	for (const s of sessions) {
		if (!s.themeProject) throw new Error(`session ${s.id} has no project`)
		const day = s.effectiveDate ?? effectiveDateFor(parseDbTimestamp(s.createdAt), programTimezone)
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
	for (const day of eachDayBetween(first, today)) days.push({ day, users: byDay.get(day) ?? 0 })
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
	const sessions = await db.orm.public.WorkSession.where({ deletedAt: null })
		.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
		.select("effectiveDate", "hoursApproved", "hoursClaimed", "hoursSource", "id")
		.include("themeProject", project =>
			project.select("userId").include("user", user => user.select("participantGoal")),
		)
		.all()

	const byDay = new Map<string, Map<ParticipantGoal, { hours: number; users: Set<string> }>>()
	for (const s of sessions) {
		if (!s.themeProject) throw new Error(`session ${s.id} has no project`)
		if (!s.themeProject.user) throw new Error(`session ${s.id} has no author`)
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
		// The person counts as active for their goal whatever the entry's source, but only a journal entry carries journal hours – a HACKATIME_TRACKED one arrives through the link, the same exclusion `getDailyActivity` makes.
		row.users.add(s.themeProject.userId)
		if (s.hoursSource !== HoursSource.HACKATIME_TRACKED) row.hours += s.hoursApproved ?? s.hoursClaimed
	}

	const days = [...byDay.keys()].toSorted()
	if (days.length === 0) return []
	const [first] = days
	const last = days.at(-1)
	if (first === undefined || last === undefined) return []
	const out: GoalDayActivity[] = []
	for (const day of eachDayBetween(first, last)) {
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
 * Uneven, and drawn as a set of bands rather than as a continuous scale: the distribution is long-tailed, so even spacing would pile almost everyone into the first bucket. The first is open at zero because every account here has at least some hours – the zero case is counted and reported rather than binned. The trailing Infinity edge is the overflow band rather than a bound, so the tail has somewhere to land.
 */
export const HOUR_EDGES = [1, 2, 3, 5, 7, 10, 15, 20, 30, 40, 60, 80, 120, 160, 240, Number.POSITIVE_INFINITY]

/**
 * Hours per account, bucketed, for the overview's distribution.
 *
 * Reads the same ledger as the geography panels (`hoursByUser`, which runs every one of these hours through `rollUpHours`), so this and the continent and country pies are the same hours counted two ways rather than two definitions that could drift apart – which is what they used to be, and they had: this panel added both sides of a timelapse overlap the ledger subtracts.
 *
 * Accounts with no hours are a count and not a bar. At three quarters of all accounts, a zero bar would be four times every other and answer a question nobody asked.
 */
export async function getHoursDistribution(): Promise<HoursDistribution> {
	const inputs = await loadRegionInputs()
	const byUser = hoursByUser(inputs)
	const perUser = [...byUser.hours.values()].filter(h => h > 0).toSorted((a, b) => a - b)

	// One bucket per edge, so the trailing Infinity edge becomes the "160+" bar and catches the long tail.
	const last = HOUR_EDGES.length - 1
	const buckets: HoursBucket[] = HOUR_EDGES.map((upper, i) => ({
		hours: 0,
		label: i === last ? `${HOUR_EDGES[last - 1]}+` : i === 0 ? `under ${upper}` : `${HOUR_EDGES[i - 1]}-${upper}`,
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
	const middleValue = perUser[middle]
	const priorValue = perUser[middle - 1]
	const median =
		middleValue === undefined
			? null
			: perUser.length % 2 === 1
				? middleValue
				: priorValue === undefined
					? null
					: (priorValue + middleValue) / 2

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
	const rows = await db.orm.public.ThemeProject.where({ deletedAt: null, theme: Theme.PCB })
		.where(project => project.user.some(user => user.onboardingCompletedAt.isNotNull()))
		.select("starterProjectId")
		.all()

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
 * The warm-up track needs no special case: it is one phase on one of the two statuses, and `scheduledWeekFor` sends both to the single warm-up column.
 */
export async function getProjectsByWeek(): Promise<WeekProjectCluster[]> {
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.select("buildStatus", "designStatus", "requestedTier", "starterProjectId", "theme", "tier")
		.all()

	const clusters = new Map<number, WeekProjectCluster>()
	for (const slot of weekSlots()) clusters.set(slot.week, { ...slot, starter: 0, tier1: 0, tier2: 0, tier3: 0 })

	for (const project of projects) {
		const column = projectColumn(project)
		for (const phase of [Phase.DESIGN, Phase.BUILD]) {
			// The same threshold `getHoursByWeek` reads: a phase starts being one of these stages when it stops being a draft, so the two charts change together rather than one counting a project the other has no hours for.
			const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
			if (status === PhaseStatus.draft) continue
			const cluster = clusters.get(scheduledWeekFor(project.theme, phase))
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
 * Hours logged for each week, split by what kind of project each hour belongs to.
 *
 * The companion to `getProjectsByWeek`: the same eleven columns and the same four kinds, measured in the hours each stage's projects have put in rather than how many of them there are. Read together, one says how much work a week's stage represents and this says how many projects are carrying it.
 *
 * Each hour is counted once. A project's phases are attributed to their own weeks rather than the whole project being counted in both – an hours chart that added a project's build hours to its design week as well would not be measuring anything that happened. The warm-up track is one column because a warm-up is one submission with one phase, so there is no second week to separate out.
 *
 * The hours are the ledger's, through `rollUpHours` on each (project, phase) – the same call the project page and the reviewer's numbers use, so a sitting that was both journalled and tracked is not counted twice here either. A project named but never logged against contributes nothing, which is why a week can be busy on the projects chart and flat on this one.
 */
export async function getHoursByWeek(): Promise<WeekHoursCluster[]> {
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => project.namedAt.isNotNull())
		.select("requestedTier", "starterProjectId", "theme", "tier", "userId")
		.include("hackatimeLinks", links =>
			links.select("cachedSeconds", "cachedSpans", "hackatimeProject", "hoursApproved", "phase"),
		)
		.include("workSessions", sessions =>
			sessions
				.select("hoursApproved", "hoursClaimed", "hoursSource", "phase")
				.where({ deletedAt: null })
				.include("timelapses", timelapse => timelapse.select("coveredSeconds", "hackatimeProject", "recordedAt")),
		)
		.all()

	const clusters = new Map<number, WeekHoursCluster>()
	for (const slot of weekSlots()) clusters.set(slot.week, { ...slot, starter: 0, tier1: 0, tier2: 0, tier3: 0 })

	// Each maker's recordings, whatever project or phase they were attached to, so a link is measured against the ones that name its project even when they live on another week's project.
	const recordingsByUser = new Map<string, RecordedWindow[]>()
	for (const project of projects) {
		const made = recordingsByUser.get(project.userId) ?? []
		for (const s of project.workSessions) {
			if (s.hoursSource === HoursSource.HACKATIME_TRACKED) continue
			for (const t of s.timelapses) {
				const window = timelapseWindow(t.recordedAt === null ? null : parseDbTimestamp(t.recordedAt), t.coveredSeconds)
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
			const sessions = project.workSessions
				.filter(s => s.phase === phase)
				.map(session =>
					withFields(session, {
						timelapses: session.timelapses.map(timelapse =>
							withFields(timelapse, {
								recordedAt: timelapse.recordedAt === null ? null : parseDbTimestamp(timelapse.recordedAt),
							}),
						),
					}),
				)
			const links = project.hackatimeLinks.filter(l => l.phase === phase)
			if (sessions.length === 0 && links.length === 0) continue

			const { computedTotal } = rollUpHours(sessions, links, null, recordings)
			const cluster = clusters.get(scheduledWeekFor(project.theme, phase))
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
	const rows = await db.orm.public.User.groupBy("verificationStatus").aggregate(group => ({
		count: group.count(),
	}))
	return rows
		.filter(row => row.count > 0)
		.map(row => ({
			label:
				row.verificationStatus === null
					? "Not asked"
					: (VERIFICATION_STATUS_LABELS[row.verificationStatus] ?? row.verificationStatus),
			users: row.count,
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
 * A project counts once however many of its phases were reviewed. A project is reviewed at most twice, design then build, and the question here is how much has had attention rather than how many hand-ins landed; `getProjectReviewStatuses` counts each project in the one state its card shows, including the ones still waiting, so it is a different question again. This figure is deliberately different from that ring and from `getAdminCounters`'s "awaiting review". The breakdown attributes each project to its most recent live review so the three outcome rows always add up to the headline above them: a project whose design was approved and whose build came back for changes reads as changes requested, which is where it actually stands.
 *
 * "Today" is the program timezone's day, the same boundary the activity strip and streaks use, so a review that landed at 11pm New York counts the day the dashboard is on rather than the server's.
 *
 * Ari's decisions are included – they reach this table through the same `finalizeReview` a console reviewer calls, and leaving them out is exactly the gap this closes.
 */
export async function getReviewerStats(): Promise<ReviewerStats> {
	const [{ programTimezone }, reviews] = await Promise.all([
		getProgramSettings(),
		db.orm.public.SubmissionReview.where({ invalidated: false, pass: ReviewPass.FINAL })
			.where(review =>
				review.submission.some(submission => submission.themeProject.some(project => project.deletedAt.isNull())),
			)
			// Newest first, so the first row seen for a project is that project's most recent live review.
			.orderBy([review => review.createdAt.desc(), review => review.id.desc()])
			.select("createdAt", "id", "result")
			.include("submission", submission => submission.select("themeProjectId"))
			.all(),
	])

	const since = startOfDay(new Date(), programTimezone)
	const latest = new Map<string, { result: ReviewResult; today: boolean }>()
	for (const review of reviews) {
		if (!review.submission) throw new Error(`review ${review.id} has no submission`)
		const { themeProjectId } = review.submission
		if (latest.has(themeProjectId)) continue
		latest.set(themeProjectId, {
			result: review.result,
			today: parseDbTimestamp(review.createdAt) >= since,
		})
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
 * The review board as one state per project: the same single state its card shows, counted once.
 *
 * A project has two phases and can be resubmitted, so a per-ship count puts one project in several slices at once – an approved design beside a build still in review, or a changes ship beside the resubmission that replaced it. This ring asks how many projects are in each state now, so every project contributes exactly one slice and the total is the number of projects that have been submitted. A project that has never left draft is in none of them.
 *
 * The state is `projectReviewState`, the same function the projects grid uses to colour a card, so the ring and the cards cannot disagree about which state a project is in. Deleted projects are left out, as they are on the grid.
 */
export async function getProjectReviewStatuses(): Promise<ProjectReviewStatusStat[]> {
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.select("buildStatus", "designStatus")
		.all()

	const counts = { approved: 0, changes: 0, not_started: 0, pending: 0, rejected: 0 }
	for (const project of projects) counts[projectReviewState(project.designStatus, project.buildStatus)] += 1

	return [
		{ label: "Approved", value: counts.approved },
		{ label: "Needs changes", value: counts.changes },
		{ label: "Rejected", value: counts.rejected },
		{ label: "Pending", value: counts.pending },
	]
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
		...devlogs.map(s => {
			if (!s.themeProject) throw new Error(`session ${s.id} has no project`)
			return { at: parseDbTimestamp(s.createdAt), key: "devlog" as const, userId: s.themeProject.userId }
		}),
		...reels.map(p => ({
			at: parseDbTimestamp(p.publishedAt ?? p.createdAt),
			key: "reel" as const,
			userId: p.userId,
		})),
		...repoLinks.map(p => ({ at: parseDbTimestamp(p.createdAt), key: "repo" as const, userId: p.userId })),
		...hackatimeLinks.map(l => {
			if (!l.themeProject) throw new Error(`hackatime link ${l.id} has no project`)
			return { at: parseDbTimestamp(l.createdAt), key: "hackatime" as const, userId: l.themeProject.userId }
		}),
		...timelapses.map(t => {
			if (!t.workSession?.themeProject) throw new Error(`timelapse ${t.id} has no project`)
			return {
				at: parseDbTimestamp(t.createdAt),
				key: "timelapse" as const,
				userId: t.workSession.themeProject.userId,
			}
		}),
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
		if (!row.themeProject) throw new Error("submission has no project")
		const at = row.resolvedAt === null ? OPEN : parseDbTimestamp(row.resolvedAt).getTime()
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
		const journalByProject = new Map(designHours.map(row => [row.themeProjectId, row.hours ?? 0]))
		const hackByProject = new Map(designHackatime.map(row => [row.themeProjectId, (row.seconds ?? 0) / 3600]))
		const latest = new Map<string, { createdAt: Date; project: (typeof projects)[number]; tier: 1 | 2 | 3 }>()
		for (const project of projects) {
			const raw = project.requestedTier ?? (project.starterProjectId !== null ? STARTER_PROJECT_TIER : null)
			if (!isTierId(raw)) continue
			const createdAt = parseDbTimestamp(project.createdAt)
			const held = latest.get(project.userId)
			if (!held || createdAt > held.createdAt) latest.set(project.userId, { createdAt, project, tier: raw })
		}
		for (const [userId, { project, tier }] of latest) {
			userTier.set(userId, tier)
			const floor = getTier(tier)?.fundingHours ?? 0
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
		// Indices in this block are all guarded by the loop bounds and the activity search; the fallback only satisfies the checker.
		const boxAt = (index: number): string => boxes[index] ?? NONE_BOX
		for (const box of boxes) counts.set(box, (counts.get(box) ?? 0) + 1)
		// The activity block fans out and back in: one ribbon per activity the person reached, from their last box before the block and to their first box after it. Fan-out ribbons share their source's people and fan-in ribbons their target's, so each direction flags its own edge for the renderer to overlap; every other ribbon carries disjoint users and stacks.
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
					const [source = "", target = ""] = key.split("\u0000")
					return { fan: entry.fan, source, target, value: entry.value }
				})
				.filter(edge => live.has(edge.source) && live.has(edge.target)),
			nodes,
			stages,
			total: users.length,
		},
	}
}
