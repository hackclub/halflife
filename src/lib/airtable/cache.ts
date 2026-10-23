import "server-only"
import { type AirtableConfig, getAirtableConfig } from "@/lib/airtable/client"

/**
 * One cached walk of the sign-up list, shared by the public counter and the referral leaderboard.
 *
 * Both need the same shape: a paginated Airtable walk that costs several slots of the process-wide throttle, an endpoint that is polled by visitors, and a failure that should not be pinned for a full minute. The cache holds the *promise*, not the result, so concurrent visitors arriving together wait on one walk instead of each starting their own.
 */

/** How long a successful walk is reused. */
const CACHE_TTL_MS = 60_000

/**
 * How long "could not walk" is reused. Short, for the same reason `repo-checks.ts` keeps its failures brief: a blip should not pin a wrong answer. `null` never enters the cache at all – a missing key is a configuration state, not a transient one.
 */
const FAILED_TTL_MS = 15_000

interface Cached<T> {
	at: number
	ttl: number
	value: Promise<T | null>
}

/**
 * Wrap a walk in a per-process cache, one entry per call to this factory.
 *
 * The walk must not reject: the cache holds its promise, so a rejected one would be handed to every caller until it expired. Resolving null is the way to say "no answer".
 */
export function cachedAirtableWalk<T>(walk: (config: AirtableConfig) => Promise<T | null>): () => Promise<T | null> {
	let cached: Cached<T> | null = null

	return () => {
		const now = Date.now()
		if (cached && now - cached.at < cached.ttl) return cached.value

		const config = getAirtableConfig()
		if (!config) return Promise.resolve(null)

		const value = walk(config)
		const entry: Cached<T> = { at: now, ttl: CACHE_TTL_MS, value }
		cached = entry
		void (async () => {
			const result = await value
			// Checked against the entry itself, so a newer walk that has since replaced it is left alone.
			if (result === null && cached === entry) entry.ttl = FAILED_TTL_MS
		})()
		return value
	}
}
