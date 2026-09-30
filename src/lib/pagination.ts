import { z } from "zod"

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100

export const paginationQuery = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
})

export type PaginationQuery = z.infer<typeof paginationQuery>

/** Prisma args for a cursor page. Fetches one extra row to detect "has more". */
export function cursorArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  }
}

export function pageResult<T extends { id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]
  return { items, nextCursor: hasMore && last ? last.id : null }
}

/**
 * Always order by a compound key ending in `id`. Ordering by a timestamp alone
 * skips or repeats rows whenever two records share a millisecond.
 */
export const NEWEST_FIRST = [{ createdAt: "desc" }, { id: "desc" }] as const
export const OLDEST_FIRST = [{ createdAt: "asc" }, { id: "asc" }] as const
