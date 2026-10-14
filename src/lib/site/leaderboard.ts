/**
 * Counting rows into a ranked leaderboard.
 *
 * Every leaderboard the bot posts is the same shape – count how many rows each person is responsible for, busiest first – written out again in each store. The tie-break is part of that shape rather than an accident of one of them: sorting only by count leaves equal rows in whatever order the database happened to return them in, so two runs over the same data can print the leaderboard in a different order and a day's post would not be comparable with yesterday's.
 */

/** One row of a ranked board. */
export interface Ranked<K extends string> {
	key: K
	count: number
}

/**
 * Counts rows per key and ranks them, busiest first, ties broken by key.
 *
 * `keyOf` returning nullish drops the row, which is how the ticket board leaves out a ticket with no closer and the review board leaves out Ari's decisions. `skip` drops a row that does have a key but should not count – a ticket closed by the person who asked it, for instance, which would otherwise read as a helper.
 */
export function tallyBoard<T, K extends string>(
	rows: readonly T[],
	keyOf: (row: T) => K | null | undefined,
	skip?: (row: T, key: K) => boolean,
): Ranked<K>[] {
	const counts = new Map<K, number>()
	for (const row of rows) {
		const key = keyOf(row)
		if (key === null || key === undefined) continue
		if (skip?.(row, key)) continue
		counts.set(key, (counts.get(key) ?? 0) + 1)
	}

	return [...counts]
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}
