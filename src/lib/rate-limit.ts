/**
 * Coarse per-instance rate limiting.
 *
 * Two copies of this existed – the upload limiter in `lib/api.ts` and the landing-page limiter in `lib/site/signups.ts` – with identical bucket and eviction code but different budgets and one behavioural difference: the signup limiter counts a refused hit, so a caller who keeps retrying stays blocked, while the upload limiter does not.
 *
 * That difference is now an explicit option rather than an accident of which copy a route happened to use.
 */

interface Bucket {
	hits: number[]
	lastSeen: number
}

interface RateLimitOptions {
	/**
	 * Whether a refused request counts against the caller's budget.
	 *
	 * No by default: a throttled caller is refused, so no hit is recorded, but they are still asking and their bucket is still in use. The signup route opts in because a caller hammering the endpoint should not get a fresh window by continuing to hammer it.
	 */
	countThrottled?: boolean
}

/** How many distinct buckets a single process will hold before the oldest are evicted. */
const MAX_KEYS = 10_000

const buckets = new Map<string, Bucket>()

/**
 * The bucket to drop when the map is over its cap.
 *
 * A Map keeps its keys in the order they were first seen, so "the oldest key" is the bucket that was created first – and the bucket that was created first is the one a throttled caller owns, because they were the first to ask and they are still asking. Evicting by when the bucket was last touched instead drops the one nobody has come back to, and the caller's own bucket is never a candidate: dropping it would hand a throttled caller a fresh budget.
 */
function evictionVictim(exclude: string): string | null {
	let victim: string | null = null
	let oldest = Number.POSITIVE_INFINITY
	for (const [key, bucket] of buckets) {
		if (key === exclude) continue
		if (bucket.lastSeen >= oldest) continue
		oldest = bucket.lastSeen
		victim = key
	}
	return victim
}

/**
 * Whether this key has spent its budget inside the window, recording the hit when it has room.
 *
 * Resets on cold start and is not shared across instances, so it stops one account spending the process's memory or storage in a loop, not a distributed attacker.
 */
export function rateLimited(
	key: string,
	{ countThrottled = false, max = 10, windowMs = 60_000 }: RateLimitOptions & { max?: number; windowMs?: number } = {},
): boolean {
	const now = Date.now()
	const bucket = buckets.get(key)
	const recent = (bucket?.hits ?? []).filter(at => now - at < windowMs)
	const limited = recent.length >= max
	if (!limited || countThrottled) recent.push(now)
	// The bucket is touched either way: a refused caller is still a caller, and their bucket is still live.
	buckets.set(key, { hits: recent, lastSeen: now })

	// Evict the buckets that have gone longest without a touch, one at a time, rather than clearing the map: a wholesale clear drops live buckets such as `upload:<userId>` along with the stale ones, which would hand a throttled caller a fresh budget.
	while (buckets.size > MAX_KEYS) {
		const victim = evictionVictim(key)
		if (!victim) break
		buckets.delete(victim)
	}

	return limited
}

export type { RateLimitOptions }
