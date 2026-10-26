import "server-only"
import { HttpError } from "@/lib/errors"
import db from "@/lib/prisma8"
import { parseDbTimestamp } from "@/lib/time"

/**
 * Lapse – where every timelapse is recorded.
 *
 * The platform stopped taking timelapse uploads: people record on Lapse, publish the timelapse there (public or unlisted), and pick it when they write the journal entry it backs. What we keep is a reference, checked against Lapse at attach time.
 *
 * Auth is the user's own OAuth token, stored on their `lapse` Account row by better-auth when they link it. Lapse issues 30-day tokens and no refresh tokens yet, so an expired token is the same answer as never having linked: sign in with Lapse again.
 */

export const LAPSE_API_BASE = (process.env.LAPSE_API_BASE ?? "https://api.lapse.hackclub.com/api").replace(/\/$/, "")

/** Where people watch a timelapse – Lapse's own page, not the raw stream. */
const LAPSE_WEB_BASE = (process.env.LAPSE_WEB_BASE ?? "https://lapse.hackclub.com").replace(/\/$/, "")

export function lapseTimelapseUrl(id: string): string {
	return `${LAPSE_WEB_BASE}/timelapse/${encodeURIComponent(id)}`
}

const TIMEOUT_MS = 10_000

export interface LapseTimelapse {
	createdAt: number
	/** Wall-clock seconds recorded – Lapse derives it from the snapshots. */
	durationSeconds: number
	hackatimeProject: string | null
	id: string
	ownerId: string
	/** Null while Lapse is still processing the video. */
	playbackUrl: string | null
	thumbnailUrl: string | null
	title: string
	visibility: "PUBLIC" | "UNLISTED" | "FAILED_PROCESSING"
}

interface RawTimelapse {
	createdAt: number
	duration: number
	id: string
	name: string
	owner: { id: string }
	playbackUrl: string | null
	private?: { hackatimeProject?: string | null } | null
	thumbnailUrl: string | null
	visibility: LapseTimelapse["visibility"]
}

function toTimelapse(t: RawTimelapse): LapseTimelapse {
	return {
		createdAt: t.createdAt,
		durationSeconds: Math.max(0, Math.round(t.duration)),
		hackatimeProject: t.private?.hackatimeProject ?? null,
		id: t.id,
		ownerId: t.owner.id,
		playbackUrl: t.playbackUrl,
		thumbnailUrl: t.thumbnailUrl,
		title: t.name,
		visibility: t.visibility,
	}
}

const NOT_LINKED = () => new HttpError("LAPSE_NOT_LINKED", "Sign in with Lapse to pick your timelapses")

/** The user's Lapse identity and a token that is still good, or a refusal. */
export async function lapseCredentials(userId: string): Promise<{ lapseUserId: string; accessToken: string }> {
	const account = await db.orm.public.Account.where({ providerId: "lapse", userId })
		.orderBy(row => row.updatedAt.desc())
		.select("accessToken", "accessTokenExpiresAt", "accountId")
		.first()
	if (!account?.accessToken) throw NOT_LINKED()
	if (account.accessTokenExpiresAt && parseDbTimestamp(account.accessTokenExpiresAt).getTime() <= Date.now())
		throw NOT_LINKED()
	return { accessToken: account.accessToken, lapseUserId: account.accountId }
}

/**
 * One call into Lapse's REST API, unwrapped from its `{ ok, data }` envelope. A 401 means the token died early (revoked, or Lapse rotated its keys) and is reported as not-linked so the UI offers the same way back in.
 */
async function call<T>(accessToken: string, path: string, query?: { [_: string]: string }) {
	const url = new URL(`${LAPSE_API_BASE}${path}`)
	for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)

	let res: Response
	try {
		res = await fetch(url, {
			cache: "no-store",
			headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		})
	} catch {
		throw new HttpError("LAPSE_UNAVAILABLE", "Lapse is not answering right now. Try again in a minute")
	}

	if (res.status === 401 || res.status === 403) throw NOT_LINKED()
	const body = (await res.json().catch(() => null)) as
		| { ok: true; data: T }
		| { ok: false; error: string; message: string }
		| null
	if (!body) throw new HttpError("LAPSE_UNAVAILABLE", `Lapse returned HTTP ${res.status}`)
	if (!body.ok) {
		if (body.error === "EXPIRED") throw NOT_LINKED()
		if (body.error === "NO_PERMISSION") throw new HttpError("VALIDATION_FAILED", "That timelapse is not one of yours")
		if (body.error === "NOT_FOUND") throw new HttpError("NOT_FOUND", "That timelapse is not on Lapse")
		throw new HttpError("LAPSE_UNAVAILABLE", body.message || "Lapse refused the request")
	}
	return body.data
}

/** A page of the user's published timelapses, newest first. */
export async function listMyTimelapses(
	userId: string,
	cursor?: string,
): Promise<{ timelapses: LapseTimelapse[]; nextCursor: string | null }> {
	const { accessToken } = await lapseCredentials(userId)
	const data = await call<{ timelapses: RawTimelapse[]; nextCursor: string | null }>(
		accessToken,
		"/timelapse/myPublishedTimelapses",
		{ limit: "50", ...(cursor ? { cursor } : {}) },
	)
	return { nextCursor: data.nextCursor, timelapses: data.timelapses.map(toTimelapse) }
}

/**
 * How many timelapses are asked about at once.
 *
 * Each id is one request to Lapse, so a list is checked a few at a time rather than all at once: a single body naming thousands of ids would otherwise turn into thousands of concurrent requests to a third party. The session schema caps how many ids a body may name, and this caps how many of them are in flight at once.
 */
const VERIFY_CHUNK_SIZE = 5

/**
 * The timelapses a session is about to claim, each confirmed with Lapse as the claimant's own, published, and finished processing.
 *
 * The id alone proves nothing – Lapse ids show up in every share link – so this is the same rule the R2 uploads had ("evidence has to be your own"), asked of the system that actually knows. Refused as a whole rather than filtered: a participant who thinks they attached a timelapse and finds it missing at review has been failed silently.
 *
 * Checked in chunks rather than in one fan-out: the ids are verified a few at a time, so the number of requests in flight is bounded by the chunk rather than by the length of the list.
 */
export async function verifyOwnTimelapses(userId: string, ids: readonly string[]): Promise<LapseTimelapse[]> {
	if (ids.length === 0) return []
	const { lapseUserId, accessToken } = await lapseCredentials(userId)

	const found: LapseTimelapse[] = []
	for (let at = 0; at < ids.length; at += VERIFY_CHUNK_SIZE) {
		const chunk = ids.slice(at, at + VERIFY_CHUNK_SIZE)
		const verified = await Promise.all(
			chunk.map(async id =>
				toTimelapse((await call<{ timelapse: RawTimelapse }>(accessToken, "/timelapse/query", { id })).timelapse),
			),
		)
		for (const t of verified) {
			if (t.ownerId !== lapseUserId)
				throw new HttpError("VALIDATION_FAILED", `"${t.title}" is not one of your timelapses`)
			if (t.visibility === "FAILED_PROCESSING")
				throw new HttpError("VALIDATION_FAILED", `"${t.title}" failed processing on Lapse`)
			if (!t.playbackUrl) throw new HttpError("VALIDATION_FAILED", `"${t.title}" is still processing on Lapse`)
		}
		found.push(...verified)
	}
	return found
}
