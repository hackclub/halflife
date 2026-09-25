import "server-only"
import prisma from "@/lib/prisma"
import { CoinBucket, LedgerKind, ShopItemCategory } from "@/app/generated/prisma/enums"
import type { LedgerEntry, Prisma } from "@/app/generated/prisma/client"

type Tx = Prisma.TransactionClient

/**
 * Serialize every credit mutation for one user.
 *
 * The balance is `SUM(amount)` over an append-only table, so there is no row to
 * lock and READ COMMITTED lets two concurrent transactions both read the same
 * pre-existing balance and both commit — which is a double-spend, not a
 * theoretical race: the window spans several round trips, and the goods on the
 * other side are physical.
 *
 * `pg_advisory_xact_lock` is released automatically when the transaction ends,
 * including on rollback. MUST be the first statement inside any `$transaction`
 * that reads a balance and then writes against it.
 */
export async function lockUserCredit(tx: Tx, userId: string): Promise<void> {
  // hashtextextended gives a stable bigint for the key; the constant is just a
  // namespace so this lock cannot collide with an unrelated advisory lock.
  // $executeRaw rather than $queryRaw: pg_advisory_xact_lock returns void, and
  // the driver adapter cannot deserialize that as a result row.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credit:${userId}`}, 0))`
}

/** Kinds that represent earning, as opposed to spending. */
const EARNING_KINDS: LedgerKind[] = [
  LedgerKind.DESIGN_BANKED_HOURS,
  LedgerKind.DESIGN_EXCESS_HOURS,
  LedgerKind.BUILD_HOURS,
  LedgerKind.BOM_SAVINGS,
  LedgerKind.THEME_COMPLETION_BONUS,
  LedgerKind.ADMIN_ADJUSTMENT,
  LedgerKind.REVIEWER_PAYMENT,
]

async function sumFor(tx: Tx, where: Prisma.LedgerEntryWhereInput): Promise<number> {
  const { _sum } = await tx.ledgerEntry.aggregate({ where, _sum: { amount: true } })
  return _sum.amount ?? 0
}

/** Both pots, plus their total. Every balance read should go through this. */
export interface Balances {
  /** Ordinary coins. Buys anything in the shop. */
  spendable: number
  /** The printer fund. Buys a printer and nothing else. */
  banked: number
  /** spendable + banked. For display only — never a spending limit. */
  total: number
}

/**
 * Authoritative balances. Always SUM(amount) — there is no balance column.
 *
 * Returns the two pots separately rather than a total and a reserve, because a
 * reserve is something a caller can forget to subtract and a pot is not: there
 * is no way to spend banked coins by accident when the number you were handed
 * never included them.
 */
export async function getBalances(tx: Tx, userId: string): Promise<Balances> {
  const [spendable, banked] = await Promise.all([
    sumFor(tx, { userId, bucket: CoinBucket.SPENDABLE }),
    sumFor(tx, { userId, bucket: CoinBucket.BANKED }),
  ])
  return { spendable, banked, total: spendable + banked }
}

/**
 * What this user can spend on `category` right now.
 *
 * Banked coins are only legal tender for a printer, so the answer depends on
 * what is being bought. This is the only function that should ever decide
 * that, and `purchase()` is its only caller that matters.
 */
export function spendableFor(balances: Balances, category: ShopItemCategory): number {
  return category === ShopItemCategory.PRINTER ? balances.total : balances.spendable
}

/** Lifetime earnings, ignoring spending. For progress displays. */
export async function getEarnedCredit(tx: Tx, userId: string): Promise<number> {
  return sumFor(tx, { userId, kind: { in: EARNING_KINDS } })
}

export interface LedgerEntryParams {
  userId: string
  kind: LedgerKind
  /** Which pot to move. Defaults to SPENDABLE; only the forced savings differ. */
  bucket?: CoinBucket
  amount: number
  note?: string | null
  themeProjectId?: string | null
  shopOrderId?: string | null
  createdById?: string | null
}

/**
 * Append one ledger row.
 *
 * MUST be called inside `prisma.$transaction` so the balance aggregate and the
 * insert cannot interleave with a concurrent write and record a
 * balanceBefore/balanceAfter pair that was never true.
 */
export async function appendLedgerEntry(tx: Tx, params: LedgerEntryParams): Promise<LedgerEntry> {
  const bucket = params.bucket ?? CoinBucket.SPENDABLE
  // Scoped to the bucket: a combined figure here would make the audit columns
  // disagree with the balance the participant was actually shown and spent
  // against, which is the one question these columns exist to answer.
  const balanceBefore = await sumFor(tx, { userId: params.userId, bucket })
  return tx.ledgerEntry.create({
    data: {
      userId: params.userId,
      kind: params.kind,
      bucket,
      amount: params.amount,
      note: params.note ?? null,
      themeProjectId: params.themeProjectId ?? null,
      shopOrderId: params.shopOrderId ?? null,
      createdById: params.createdById ?? null,
      balanceBefore,
      balanceAfter: balanceBefore + params.amount,
    },
  })
}

export interface ReconcileParams {
  userId: string
  themeProjectId: string
  kind: LedgerKind
  /**
   * The pot this kind pays into. Fixed per kind — DESIGN_BANKED_HOURS is
   * always BANKED and everything else is always SPENDABLE — so passing the
   * wrong one here would split one grant across two pots and make the
   * reconcile sum converge on a target it can never reach.
   */
  bucket?: CoinBucket
  /** What the total for this (user, project, kind) should now be. */
  target: number
  note: string
  createdById?: string | null
}

/**
 * Append a single delta row so that SUM(amount) over
 * (userId, themeProjectId, kind) equals `target`. Returns null when nothing
 * needed to change.
 *
 * This is what makes re-review idempotent: approving the same project five
 * times converges on one balance instead of compounding, and un-approving is
 * the same call with `target: 0` rather than a separate reversal code path —
 * so there is no separate reversal code path to get wrong.
 *
 * Stasis instead pairs every kind with a *_REVERSED twin and cancels by hand,
 * which means every aggregate over the ledger has to remember to include the
 * twin. Its lib/currency.ts carries a long comment about the query that
 * forgot and overcounted forever.
 *
 * Must run inside a transaction, for the same reason as appendLedgerEntry.
 */
export async function reconcileGrant(tx: Tx, params: ReconcileParams): Promise<LedgerEntry | null> {
  const current = await sumFor(tx, {
    userId: params.userId,
    themeProjectId: params.themeProjectId,
    kind: params.kind,
  })
  const delta = params.target - current
  if (delta === 0) return null

  return appendLedgerEntry(tx, {
    userId: params.userId,
    kind: params.kind,
    bucket: params.bucket ?? CoinBucket.SPENDABLE,
    amount: delta,
    note: params.note,
    themeProjectId: params.themeProjectId,
    createdById: params.createdById ?? null,
  })
}

export async function getLedgerPage(
  userId: string,
  cursor: string | undefined,
  limit: number,
): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
  const rows = await prisma.ledgerEntry.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? last.id : null }
}

export { CoinBucket, LedgerKind }
