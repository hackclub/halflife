import "server-only"
import { CoinBucket, LedgerKind, type ShopItemCategory } from "@/app/generated/prisma/enums"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { lockKey } from "@/lib/locks"
import { decodeCursor, encodeCursor } from "@/lib/pagination"
import db, { type DbOrTx } from "@/lib/prisma8"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

/**
 * Serialize every credit mutation for one user.
 *
 * MUST be the first statement inside any transaction that reads a balance and then writes against it; see `lockKey`.
 */
export function lockUserCredit(tx: DbOrTx, userId: string): Promise<void> {
	return lockKey(tx, `credit:${userId}`)
}

/** Kinds that represent earning, as opposed to spending. */
const EARNING_KINDS: LedgerKind[] = [
	LedgerKind.DESIGN_BANKED_HOURS,
	LedgerKind.DESIGN_EXCESS_HOURS,
	LedgerKind.BUILD_BANKED_HOURS,
	LedgerKind.BUILD_HOURS,
	LedgerKind.BOM_SAVINGS,
	LedgerKind.THEME_COMPLETION_BONUS,
	LedgerKind.ADMIN_ADJUSTMENT,
	LedgerKind.REVIEWER_PAYMENT,
]

async function sumFor(
	tx: DbOrTx,
	filter: { bucket?: CoinBucket; kinds?: LedgerKind[]; themeProjectId?: string; userId: string },
): Promise<number> {
	const { kinds, themeProjectId, bucket } = filter
	let entries = tx.orm.public.LedgerEntry.where({ userId: filter.userId })
	if (bucket !== undefined) entries = entries.where({ bucket })
	if (kinds !== undefined) entries = entries.where(entry => entry.kind.in(kinds))
	if (themeProjectId !== undefined) entries = entries.where({ themeProjectId })
	const { total } = await entries.aggregate(a => ({ total: a.sum("amount") }))
	return total ?? 0
}

/** A single spendable pot, plus its legacy split. Every balance read should go through this. */
export interface Balances {
	/**
	 * The legacy locked printer fund. New mints never land here – everything is spendable now – but old rows keep their bucket until they are converted, so this drains to zero rather than vanishing.
	 */
	banked: number
	/** Every coin. Buys anything in the shop, printers included. */
	spendable: number
	/** spendable + banked. The number every purchase and progress display reads. */
	total: number
}

/**
 * Authoritative balances. Always SUM(amount) – there is no balance column.
 *
 * The two sums are read one after the other, never together. An interactive transaction is a single connection, so two queries issued at once on the same `tx` are interleaved on that one connection rather than run in parallel: the second aggregate is evaluated against a snapshot the first one already moved past, and the transaction's timeout is spent on both at once. Sequential reads keep the two halves of a balance describing the same moment, which is the only thing a balance is for.
 */
export async function getBalances(tx: DbOrTx, userId: string): Promise<Balances> {
	const spendable = await sumFor(tx, { bucket: CoinBucket.SPENDABLE, userId })
	const banked = await sumFor(tx, { bucket: CoinBucket.BANKED, userId })
	return { banked, spendable, total: spendable + banked }
}

/**
 * What this user can spend right now: the whole balance, whatever it was minted as. The locked printer fund is gone – every coin is spendable on anything – so there is nothing left for the category to decide. The parameter stays so the two call sites do not have to learn about the merge; it is ignored.
 */
export function spendableFor(balances: Balances, _category: ShopItemCategory): number {
	return balances.total
}

/** Lifetime earnings, ignoring spending. For progress displays. */
export function getEarnedCredit(tx: DbOrTx, userId: string): Promise<number> {
	return sumFor(tx, { kinds: EARNING_KINDS, userId })
}

export interface LedgerEntryParams {
	amount: number
	/** Which pot to move. Defaults to SPENDABLE; only the forced savings differ. */
	bucket?: CoinBucket
	createdById?: string | null
	kind: LedgerKind
	note?: string | null
	shopOrderId?: string | null
	themeProjectId?: string | null
	userId: string
}

/** One ledger row as `create` returns it: scalars only, no relations loaded. */
export type NewLedgerEntry = Omit<Models.public_LedgerEntry, "shopOrder" | "themeProject" | "user">

/**
 * Append one ledger row.
 *
 * MUST be called inside a transaction so the balance aggregate and the insert cannot interleave with a concurrent write and record a balanceBefore/balanceAfter pair that was never true.
 */
export async function appendLedgerEntry(tx: DbOrTx, params: LedgerEntryParams): Promise<NewLedgerEntry> {
	const bucket = params.bucket ?? CoinBucket.SPENDABLE
	// Scoped to the bucket: a combined figure here would make the audit columns disagree with the balance the participant was actually shown and spent against, which is the one question these columns exist to answer.
	const balanceBefore = await sumFor(tx, { bucket, userId: params.userId })
	return tx.orm.public.LedgerEntry.create({
		amount: params.amount,
		balanceAfter: balanceBefore + params.amount,
		balanceBefore,
		bucket,
		createdById: params.createdById ?? null,
		kind: params.kind,
		note: params.note ?? null,
		shopOrderId: params.shopOrderId ?? null,
		themeProjectId: params.themeProjectId ?? null,
		userId: params.userId,
	})
}

export interface ReconcileParams {
	/**
	 * The pot this kind pays into. New mints always land in SPENDABLE; the BANKED kinds below only ever reconcile the legacy locked rows toward zero, so passing anything else here would split one grant across two pots and make the reconcile sum converge on a target it can never reach.
	 */
	bucket?: CoinBucket
	createdById?: string | null
	kind: LedgerKind
	note: string
	/** What the total for this (user, project, kind) should now be. */
	target: number
	themeProjectId: string
	userId: string
}

/**
 * What a reconcile did.
 */
export interface ReconcileResult {
	/** The row it wrote, or null when the total was already where it had to be. */
	entry: NewLedgerEntry | null
	/**
	 * Coins the maker had already spent, so the reversal could not take them back.
	 */
	unrecovered: number
}

/**
 * Append a single delta row so that SUM(amount) over (userId, themeProjectId, kind) equals `target`. Writes nothing when the total is already there.
 *
 * This is what makes re-review idempotent: approving the same project five times converges on one balance instead of compounding, and un-approving is the same call with `target: 0` rather than a separate reversal code path – so there is no separate reversal code path to get wrong.
 *
 * A delta that takes coins back only takes what the maker still has. The sum it reconciles against is the grant's own rows, which say nothing about what has since been spent: a grant of 100 coins that has been spent down to 70 would take 100 back and leave the pot at −30. A negative balance is a state the shop and every display refuse to render, so the reversal stops at zero, says in the row's note how much it could not take, and reports it here. The maker keeps what they spent and the programme carries the difference; the alternative – refusing the un-approval – would leave a wrongly approved design standing, which is the thing the un-approval exists to fix.
 *
 * Stasis instead pairs every kind with a *_REVERSED twin and cancels by hand, which means every aggregate over the ledger has to remember to include the twin. Its lib/currency.ts carries a long comment about the query that forgot and overcounted forever.
 *
 * Must run inside a transaction, for the same reason as appendLedgerEntry.
 */
export async function reconcileGrant(tx: DbOrTx, params: ReconcileParams): Promise<ReconcileResult> {
	const current = await sumFor(tx, {
		kinds: [params.kind],
		themeProjectId: params.themeProjectId,
		userId: params.userId,
	})
	const delta = params.target - current
	if (delta === 0) return { entry: null, unrecovered: 0 }

	const bucket = params.bucket ?? CoinBucket.SPENDABLE
	let amount = delta
	let unrecovered = 0
	if (delta < 0) {
		// The pot being moved, not the combined balance: banked coins are not available to cover a spendable shortfall, exactly as the admin adjustment route guards it.
		const balance = await sumFor(tx, { bucket, userId: params.userId })
		const take = Math.min(-delta, Math.max(balance, 0))
		amount = -take
		unrecovered = -delta - take
	}

	// The note carries the shortfall, so the row is the whole story: a "-70" on its own would hide that 30 coins of the grant are still out there.
	const note =
		unrecovered > 0
			? `${params.note} – ${unrecovered} could not be taken back: the maker had already spent them`
			: params.note

	const entry = await appendLedgerEntry(tx, {
		amount,
		bucket,
		createdById: params.createdById ?? null,
		kind: params.kind,
		note,
		themeProjectId: params.themeProjectId,
		userId: params.userId,
	})

	return { entry, unrecovered }
}

/** One row of the ledger page. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface LedgerEntryRow {
	amount: number
	balanceAfter: number
	balanceBefore: number
	bucket: Models.public_LedgerEntry["bucket"]
	createdAt: Date
	createdById: string | null
	id: string
	kind: Models.public_LedgerEntry["kind"]
	note: string | null
	shopOrderId: string | null
	themeProjectId: string | null
	userId: string
}

export async function getLedgerPage(
	userId: string,
	cursor: string | undefined,
	limit: number,
): Promise<{ items: LedgerEntryRow[]; nextCursor: string | null }> {
	const filtered = db.orm.public.LedgerEntry.where({ userId }).orderBy([
		entry => entry.createdAt.desc(),
		entry => entry.id.desc(),
	])
	// Only the API reads this list, so a cursor that is not one of ours is a bad request rather than a page to fall back to.
	const position = cursor === undefined ? null : decodeCursor(cursor)
	const paged =
		position?.at === undefined || position?.at === null
			? filtered
			: filtered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
	const rows = await paged
		.limit(limit + 1)
		.select(
			"amount",
			"balanceAfter",
			"balanceBefore",
			"bucket",
			"createdAt",
			"createdById",
			"id",
			"kind",
			"note",
			"shopOrderId",
			"themeProjectId",
			"userId",
		)
		.all()
	const items = rows.slice(0, limit).map(row => ({ ...row, createdAt: parseDbTimestamp(row.createdAt) }))
	const last = items.at(-1)
	return {
		items,
		nextCursor: rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
	}
}

export { CoinBucket, LedgerKind } from "@/app/generated/prisma/enums"
