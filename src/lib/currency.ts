import "server-only"
import type { LedgerEntry, Prisma } from "@/app/generated/prisma/client"
import { CoinBucket, LedgerKind, type ShopItemCategory } from "@/app/generated/prisma/enums"
import prisma from "@/lib/prisma"

type Tx = Prisma.TransactionClient

/**
 * Serialize every credit mutation for one user.
 *
 * The balance is `SUM(amount)` over an append-only table, so there is no row to lock and READ COMMITTED lets two concurrent transactions both read the same pre-existing balance and both commit – which is a double-spend, not a theoretical race: the window spans several round trips, and the goods on the other side are physical.
 *
 * `pg_advisory_xact_lock` is released automatically when the transaction ends, including on rollback. MUST be the first statement inside any `$transaction` that reads a balance and then writes against it.
 */
export async function lockUserCredit(tx: Tx, userId: string): Promise<void> {
	// hashtextextended gives a stable bigint for the key; the constant is just a namespace so this lock cannot collide with an unrelated advisory lock. $executeRaw rather than $queryRaw: pg_advisory_xact_lock returns void, and the driver adapter cannot deserialize that as a result row.
	await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credit:${userId}`}, 0))`
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

async function sumFor(tx: Tx, where: Prisma.LedgerEntryWhereInput): Promise<number> {
	const { _sum } = await tx.ledgerEntry.aggregate({ _sum: { amount: true }, where })
	return _sum.amount ?? 0
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
 */
export async function getBalances(tx: Tx, userId: string): Promise<Balances> {
	const [spendable, banked] = await Promise.all([
		sumFor(tx, { bucket: CoinBucket.SPENDABLE, userId }),
		sumFor(tx, { bucket: CoinBucket.BANKED, userId }),
	])
	return { banked, spendable, total: spendable + banked }
}

/**
 * What this user can spend right now: the whole balance, whatever it was minted as. The locked printer fund is gone – every coin is spendable on anything – so there is nothing left for the category to decide. The parameter stays so the two call sites do not have to learn about the merge; it is ignored.
 */
export function spendableFor(balances: Balances, _category: ShopItemCategory): number {
	return balances.total
}

/** Lifetime earnings, ignoring spending. For progress displays. */
export function getEarnedCredit(tx: Tx, userId: string): Promise<number> {
	return sumFor(tx, { kind: { in: EARNING_KINDS }, userId })
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

/**
 * Append one ledger row.
 *
 * MUST be called inside `prisma.$transaction` so the balance aggregate and the insert cannot interleave with a concurrent write and record a balanceBefore/balanceAfter pair that was never true.
 */
export async function appendLedgerEntry(tx: Tx, params: LedgerEntryParams): Promise<LedgerEntry> {
	const bucket = params.bucket ?? CoinBucket.SPENDABLE
	// Scoped to the bucket: a combined figure here would make the audit columns disagree with the balance the participant was actually shown and spent against, which is the one question these columns exist to answer.
	const balanceBefore = await sumFor(tx, { bucket, userId: params.userId })
	return tx.ledgerEntry.create({
		data: {
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
		},
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
 * Append a single delta row so that SUM(amount) over (userId, themeProjectId, kind) equals `target`. Returns null when nothing needed to change.
 *
 * This is what makes re-review idempotent: approving the same project five times converges on one balance instead of compounding, and un-approving is the same call with `target: 0` rather than a separate reversal code path – so there is no separate reversal code path to get wrong.
 *
 * Stasis instead pairs every kind with a *_REVERSED twin and cancels by hand, which means every aggregate over the ledger has to remember to include the twin. Its lib/currency.ts carries a long comment about the query that forgot and overcounted forever.
 *
 * Must run inside a transaction, for the same reason as appendLedgerEntry.
 */
export async function reconcileGrant(tx: Tx, params: ReconcileParams): Promise<LedgerEntry | null> {
	const current = await sumFor(tx, {
		kind: params.kind,
		themeProjectId: params.themeProjectId,
		userId: params.userId,
	})
	const delta = params.target - current
	if (delta === 0) return null

	return appendLedgerEntry(tx, {
		amount: delta,
		bucket: params.bucket ?? CoinBucket.SPENDABLE,
		createdById: params.createdById ?? null,
		kind: params.kind,
		note: params.note,
		themeProjectId: params.themeProjectId,
		userId: params.userId,
	})
}

export async function getLedgerPage(
	userId: string,
	cursor: string | undefined,
	limit: number,
): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
	const rows = await prisma.ledgerEntry.findMany({
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: limit + 1,
		where: { userId },
		...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
	})
	const hasMore = rows.length > limit
	const items = hasMore ? rows.slice(0, limit) : rows
	const last = items.at(-1)
	return { items, nextCursor: hasMore && last ? last.id : null }
}

export { CoinBucket, LedgerKind } from "@/app/generated/prisma/enums"
