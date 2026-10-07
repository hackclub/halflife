import "server-only"
import { HttpError } from "@/lib/errors"
import prisma from "@/lib/prisma"

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
	id: string
	title: string
	/** Wall-clock seconds recorded – Lapse derives it from the snapshots. */
	durationSeconds: number
	visibility: "PUBLIC" | "UNLISTED" | "FAILED_PROCESSING"
	createdAt: number
	/** Null while Lapse is still processing the video. */
	playbackUrl: string | null
	thumbnailUrl: string | null
	hackatimeProject: string | null
	ownerId: string
}

interface RawTimelapse {
	id: string
	name: string
	duration: number
	visibility: LapseTimelapse["visibility"]
	createdAt: number
	playbackUrl: string | null
	thumbnailUrl: string | null
	owner: { id: string }
	private?: { hackatimeProject?: string | null } | null
}

function toTimelapse(t: RawTimelapse): LapseTimelapse {
	return {
		id: t.id,
		title: t.name,
		durationSeconds: Math.max(0, Math.round(t.duration)),
		visibility: t.visibility,
		createdAt: t.createdAt,
		playbackUrl: t.playbackUrl,
		thumbnailUrl: t.thumbnailUrl,
		hackatimeProject: t.private?.hackatimeProject ?? null,
		ownerId: t.owner.id,
	}
}

const NOT_LINKED = () => new HttpError("LAPSE_NOT_LINKED", "Sign in with Lapse to pick your timelapses")

/** The user's Lapse identity and a token that is still good, or a refusal. */
export async function lapseCredentials(userId: string) {
	const account = await prisma.account.findFirst({
		where: { userId, providerId: "lapse" },
		orderBy: { updatedAt: "desc" },
		select: { accountId: true, accessToken: true, accessTokenExpiresAt: true },
	})
	if (!account?.accessToken) throw NOT_LINKED()
	if (account.accessTokenExpiresAt && account.accessTokenExpiresAt.getTime() <= Date.now()) {
		throw NOT_LINKED()
	}
	return { lapseUserId: account.accountId, accessToken: account.accessToken }
}

/**
 * One call into Lapse's REST API, unwrapped from its `{ ok, data }` envelope. A 401 means the token died early (revoked, or Lapse rotated its keys) and is reported as not-linked so the UI offers the same way back in.
 */
async function call<T>(accessToken: string, path: string, query?: Record<string, string>) {
	const url = new URL(`${LAPSE_API_BASE}${path}`)
	for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)

	let res: Response
	try {
		res = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
			signal: AbortSignal.timeout(TIMEOUT_MS),
			cache: "no-store",
		})
	} catch {
		throw new HttpError("LAPSE_UNAVAILABLE", "Lapse is not answering right now – try again in a minute")
	}

	if (res.status === 401 || res.status === 403) throw NOT_LINKED()
	const body = (await res.json().catch(() => null)) as
		| { ok: true; data: T }
		| { ok: false; error: string; message: string }
		| null
	if (!body) throw new HttpError("LAPSE_UNAVAILABLE", `Lapse returned HTTP ${res.status}`)
	if (!body.ok) {
		if (body.error === "EXPIRED") throw NOT_LINKED()
		if (body.error === "NO_PERMISSION") {
			throw new HttpError("VALIDATION_FAILED", "That timelapse is not one of yours")
		}
		if (body.error === "NOT_FOUND") throw new HttpError("NOT_FOUND", "That timelapse is not on Lapse")
		throw new HttpError("LAPSE_UNAVAILABLE", body.message || "Lapse refused the request")
	}
	return body.data
}

/** A page of the user's published timelapses, newest first. */
export async function listMyTimelapses(userId: string, cursor?: string) {
	const { accessToken } = await lapseCredentials(userId)
	const data = await call<{ timelapses: RawTimelapse[]; nextCursor: string | null }>(
		accessToken,
		"/timelapse/myPublishedTimelapses",
		{ limit: "50", ...(cursor ? { cursor } : {}) },
	)
	return { timelapses: data.timelapses.map(toTimelapse), nextCursor: data.nextCursor }
}

/**
 * The timelapses a session is about to claim, each confirmed with Lapse as the claimant's own, published, and finished processing.
 *
 * The id alone proves nothing – Lapse ids show up in every share link – so this is the same rule the R2 uploads had ("evidence has to be your own"), asked of the system that actually knows. Refused as a whole rather than filtered: a participant who thinks they attached a timelapse and finds it missing at review has been failed silently.
 */
export async function verifyOwnTimelapses(userId: string, ids: readonly string[]) {
	if (ids.length === 0) return []
	const { lapseUserId, accessToken } = await lapseCredentials(userId)

	const found = await Promise.all(
		ids.map(async (id) =>
			toTimelapse((await call<{ timelapse: RawTimelapse }>(accessToken, "/timelapse/query", { id })).timelapse),
		),
	)

	for (const t of found) {
		if (t.ownerId !== lapseUserId) {
			throw new HttpError("VALIDATION_FAILED", `"${t.title}" is not one of your timelapses`)
		}
		if (t.visibility === "FAILED_PROCESSING") {
			throw new HttpError("VALIDATION_FAILED", `"${t.title}" failed processing on Lapse`)
		}
		if (!t.playbackUrl) {
			throw new HttpError("VALIDATION_FAILED", `"${t.title}" is still processing on Lapse`)
		}
	}
	return found
}
