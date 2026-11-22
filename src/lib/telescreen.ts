import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { createSlot } from "@/lib/concurrency"
import { PhaseStatus } from "@/lib/enums"
import type { JsonValue } from "@/lib/json"
import { lapseTimelapseUrl } from "@/lib/lapse"
import db from "@/lib/prisma8"
import { githubRepoFrom } from "@/lib/review-platform/repo"
import type { ReviewRobert, ReviewSporkMatch, ReviewSporkVerdict, ReviewTelescreen } from "@/lib/review-platform/types"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * Fabricate's Robert and Spork integrations, on Half Life's data. Both live in Telescreen (telescreen.hackclub.com), Hack Club's fraud review cockpit.
 *
 * Robert is the fraud review: every project is sent as a hardware journal when it is handed in (and again on approval, so the journal stays current), one Robert project per Half Life project under `halflife-project-<id>`. Its trust score and outcome come back through `/api/integrations/robert/webhook` and the `telescreen-sync` job. A project approved here with a score of 8 or more is approved in Robert automatically, one rejected here with nothing approved is rejected there, and anything else waits for an admin on the review screen's Robert card.
 *
 * Spork finds near-identical KiCad boards and STEP models in other repos. Robert runs it on what it is sent; it is also called directly on every hand-in, one screen at a time, and the result shows on the review screen's Spork card, where a reviewer can mark the flag real or false.
 *
 * Everything is kept on one `TelescreenCheck` row per project. Evidence for the reviewer, never a decision: nothing here touches a review.
 */

const ROBERT_URL = "https://telescreen.hackclub.com/api/v1/ysws/"
const SPORK_URL = "https://telescreen.hackclub.com/api/workbench/spork/screen"
const USER_AGENT = "halflife.hackclub.com"
const ROBERT_TIMEOUT_MS = 15_000
export const SPORK_TIMEOUT_MS = 5 * 60_000
const PAGE_SIZE = 100
const SIGNATURE_TOLERANCE_S = 5 * 60
const FRAUD_MAX_SCORE = 4
const CLEAN_MIN_SCORE = 8
const MAX_JOURNAL_ENTRIES = 500
const HTTP_URL = /^https?:\/\/\S+$/i
const UNRESOLVED = new Set([null, "awaiting_review", "awaiting_outcome"])
export const SPORK_VERDICTS = ["real", "false_flag"] as const
export type SporkVerdict = (typeof SPORK_VERDICTS)[number]

export class TelescreenError extends Error {
	readonly status: number | null

	constructor(message: string, status: number | null = null) {
		super(message)
		this.name = "TelescreenError"
		this.status = status
	}
}

export const isRobertConfigured = (): boolean => Boolean(process.env.ROBERT_API_KEY)
export const isSporkConfigured = (): boolean => Boolean(process.env.SPORK_API_KEY)

const robertSporkSchema = z.looseObject({
	matches: z
		.array(
			z.looseObject({
				containment: z.number().nullish(),
				repo: z.string().nullish(),
				url: z.string().nullish(),
			}),
		)
		.nullish(),
	mode: z.string().nullish(),
	reason: z.string().nullish(),
	status: z.string().nullish(),
})

const robertProjectSchema = z.looseObject({
	conflicts: z.array(z.string()).nullish(),
	creditedSeconds: z.number().nullish(),
	id: z.string(),
	outcome: z
		.looseObject({ at: z.string().nullish(), reason: z.string().nullish(), status: z.string().nullish() })
		.nullish(),
	review: z
		.looseObject({
			at: z.string().nullish(),
			fields: z.record(z.string(), z.unknown()).nullish(),
			note: z.string().nullish(),
			reviewer: z.looseObject({ name: z.string().nullish() }).nullish(),
		})
		.nullish(),
	spork: robertSporkSchema.nullish(),
	state: z.string().nullish(),
	trustScore: z.number().nullish(),
})
type RobertProject = z.infer<typeof robertProjectSchema>

const robertOutcomeSchema = z.looseObject({
	reason: z.string().nullish(),
	reviewedAt: z.string().nullish(),
	reviewFields: z.record(z.string(), z.unknown()).nullish(),
	status: z.string().nullish(),
	trustScore: z.number().nullish(),
})

const webhookSchema = z.looseObject({
	event: z.string(),
	outcome: robertOutcomeSchema.nullish(),
	projectId: z.string().nullish(),
})

const sporkResultSchema = z.looseObject({
	errors: z.array(z.looseObject({ message: z.string().nullish(), mode: z.string().nullish() })).nullish(),
	mode: z.string().nullish(),
	results: z
		.array(
			z.looseObject({
				matches: z
					.array(
						z.looseObject({
							containment: z.number().nullish(),
							repo: z.string().nullish(),
							url: z.string().nullish(),
						}),
					)
					.nullish(),
				mode: z.string().nullish(),
				verdict: z.string().nullish(),
			}),
		)
		.nullish(),
})

const sporkVerdictSchema = z.object({
	at: z.string(),
	by: z.string().nullable(),
	repos: z.array(z.string()),
	verdict: z.enum(SPORK_VERDICTS),
})

const nowText = (): string => formatDbTimestamp(new Date())

/** Robert's JSON shapes are its own; anything this module stores is checked against the schemas above first. */
const json = (value: unknown): JsonValue =>
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a JSON round trip is JSON by construction
	JSON.parse(JSON.stringify(value ?? null)) as JsonValue

async function robertRequest(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
	const key = process.env.ROBERT_API_KEY
	if (!key) throw new TelescreenError("ROBERT_API_KEY must be set")
	let response: Response
	try {
		response = await fetch(new URL(path, ROBERT_URL), {
			...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
			headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
			method,
			signal: AbortSignal.timeout(ROBERT_TIMEOUT_MS),
		})
	} catch (err) {
		throw new TelescreenError(`Robert ${method} ${path} failed: ${err instanceof Error ? err.message : String(err)}`)
	}
	const text = await response.text()
	if (!response.ok) {
		let message = text.slice(0, 300)
		try {
			;({ message } = z.object({ message: z.string() }).parse(JSON.parse(text)))
		} catch {
			// Not Robert's JSON error shape: the body itself says what happened.
		}
		throw new TelescreenError(`Robert ${method} ${path} failed: ${response.status} ${message}`, response.status)
	}
	return JSON.parse(text)
}

interface CheckRow {
	id: string
	robertId: string | null
	robertState: string | null
	themeProjectId: string
	trustScore: number | null
}

/** The project's row, made on first use. Two first uses can race; the unique index keeps one. */
async function checkFor(themeProjectId: string): Promise<CheckRow> {
	const select = ["id", "robertId", "robertState", "themeProjectId", "trustScore"] as const
	const existing = await db.orm.public.TelescreenCheck.where({ themeProjectId })
		.select(...select)
		.first()
	if (existing) return existing
	try {
		await db.orm.public.TelescreenCheck.create({ themeProjectId })
	} catch (err) {
		const raced = await db.orm.public.TelescreenCheck.where({ themeProjectId })
			.select(...select)
			.first()
		if (!raced) throw err
		return raced
	}
	return db.orm.public.TelescreenCheck.where({ themeProjectId })
		.select(...select)
		.firstOrThrow()
}

/** What Robert is sent: the project as a hardware journal. Refused (422) when it has no repo link, no Slack id or no journal, which Robert needs. */
async function robertPayload(themeProjectId: string): Promise<object> {
	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
		.select("deletedAt", "githubRepo", "id", "title")
		.include("user", user => user.select("slackId"))
		.first()
	if (!project || project.deletedAt) throw new TelescreenError("No such project", 404)
	const codeUrl = project.githubRepo?.trim() ?? ""
	if (!HTTP_URL.test(codeUrl)) throw new TelescreenError("This project has no repository link", 422)
	const slackId = project.user?.slackId?.trim().toUpperCase()
	if (!slackId) throw new TelescreenError("The maker has no Slack ID", 422)

	const sessions = await db.orm.public.WorkSession.where({ deletedAt: null, themeProjectId })
		.include("media", media => media.orderBy(m => m.sortOrder.asc()))
		.include("timelapses")
		.orderBy(session => session.createdAt.asc())
		.limit(MAX_JOURNAL_ENTRIES)
		.all()
	if (sessions.length === 0) throw new TelescreenError("This project has no journal entries", 422)

	const journal = sessions.map(session => {
		const timelapses = session.timelapses.flatMap(t => {
			if (t.provider === "lapse" && t.externalId) return [lapseTimelapseUrl(t.externalId)]
			const url = t.playbackUrl ?? publicUrlFor(t.objectKey)
			return url ? [url] : []
		})
		return {
			content: [session.content ?? "", ...timelapses.map(url => `Timelapse: ${url}`)].filter(Boolean).join("\n\n"),
			hours: Math.round(session.hoursClaimed * 100) / 100,
			images: session.media.flatMap(m => {
				const url = publicUrlFor(m.objectKey)
				return url && HTTP_URL.test(url) ? [url] : []
			}),
			loggedAt: session.effectiveDate
				? new Date(`${session.effectiveDate}T00:00:00Z`).toISOString()
				: parseDbTimestamp(session.createdAt).toISOString(),
			title: session.title.trim() || `Entry ${session.id}`,
		}
	})

	return {
		codeUrl,
		externalId: `halflife-project-${project.id}`,
		journal,
		kind: "hardware",
		name: project.title.trim() || "Untitled project",
		submitter: { slackId },
	}
}

/**
 * Send the project to Robert, or send it again with its current journal. Robert keys it on the external id, so a resend updates the same Robert project. A failure is kept on the row for the review screen, and rethrown.
 */
export async function submitToRobert(themeProjectId: string, sentByName: string | null = null): Promise<void> {
	const check = await checkFor(themeProjectId)
	try {
		const data = z
			.looseObject({ conflicts: z.array(z.string()).nullish(), id: z.string(), state: z.string().nullish() })
			.parse(await robertRequest("POST", "projects", await robertPayload(themeProjectId)))
		const row = await db.orm.public.TelescreenCheck.where({ id: check.id })
			.select("sentByName", "submittedAt")
			.firstOrThrow()
		await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
			conflicts: json(data.conflicts ?? []),
			robertError: null,
			robertId: data.id,
			robertState: data.state ?? null,
			sentByName: row.sentByName ?? sentByName,
			submittedAt: row.submittedAt ?? nowText(),
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		await db.orm.public.TelescreenCheck.where({ id: check.id }).update({ robertError: message.slice(0, 1000) })
		throw err
	}
}

/** Read the project back from Robert now, rather than waiting for the sync. */
export async function refreshFromRobert(themeProjectId: string): Promise<void> {
	const check = await checkFor(themeProjectId)
	if (!check.robertId) return
	const data = z
		.object({ project: robertProjectSchema })
		.parse(await robertRequest("GET", `projects/${encodeURIComponent(check.robertId)}`))
	await applyRobertProject(check, data.project)
}

async function applyRobertProject(check: CheckRow, data: RobertProject): Promise<void> {
	await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
		creditedSeconds: data.creditedSeconds ?? null,
		outcomeAt: data.outcome?.at ?? null,
		outcomeReason: data.outcome?.reason ?? null,
		outcomeStatus: data.outcome?.status ?? null,
		reviewedAt: data.review?.at ?? null,
		reviewerName: data.review?.reviewer?.name ?? null,
		reviewFields: json(data.review?.fields ?? {}),
		reviewNote: data.review?.note ?? null,
		robertSpork: data.spork ? json(data.spork) : null,
		robertState: data.state ?? null,
		syncedAt: nowText(),
		trustScore: data.trustScore ?? null,
	})
	await settleOutcome({ ...check, robertState: data.state ?? null, trustScore: data.trustScore ?? null })
}

/**
 * Once Robert's fraud review passes, the outcome is ours to record. A project approved here with a clean score is approved there; one rejected here with nothing approved is rejected with the review's feedback. Anything else waits for an admin.
 */
async function settleOutcome(check: CheckRow): Promise<void> {
	if (check.robertState !== "awaiting_outcome" || !check.robertId) return
	const project = await db.orm.public.ThemeProject.whereUnique({ id: check.themeProjectId })
		.select("buildReviewComments", "buildStatus", "designReviewComments", "designStatus")
		.first()
	if (!project) return
	const approved = project.designStatus === PhaseStatus.approved || project.buildStatus === PhaseStatus.approved
	if (approved) {
		if ((check.trustScore ?? 0) >= CLEAN_MIN_SCORE) await recordRobertOutcome(check.themeProjectId, "approved")
		return
	}
	if (project.buildStatus === PhaseStatus.rejected || project.designStatus === PhaseStatus.rejected) {
		const reason =
			(project.buildStatus === PhaseStatus.rejected ? project.buildReviewComments : project.designReviewComments) ?? ""
		await recordRobertOutcome(check.themeProjectId, "rejected", reason.trim() || "Rejected in Half Life review")
	}
}

/** Record our decision in Robert. A rejection needs a reason. */
export async function recordRobertOutcome(
	themeProjectId: string,
	status: "approved" | "rejected",
	reason: string | null = null,
): Promise<void> {
	if (status === "rejected" && !reason?.trim()) throw new TelescreenError("A reason is required to reject", 422)
	const check = await checkFor(themeProjectId)
	if (!check.robertId) throw new TelescreenError("This project hasn't been sent to Robert", 422)
	const data = z
		.looseObject({
			outcome: z
				.looseObject({ at: z.string().nullish(), reason: z.string().nullish(), status: z.string().nullish() })
				.nullish(),
			state: z.string().nullish(),
		})
		.parse(
			await robertRequest("POST", `projects/${encodeURIComponent(check.robertId)}/outcome`, {
				reason: reason?.trim() || undefined,
				status,
			}),
		)
	await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
		outcomeAt: data.outcome?.at ?? null,
		outcomeReason: data.outcome?.reason ?? null,
		outcomeStatus: data.outcome?.status ?? null,
		robertState: data.state ?? null,
		syncedAt: nowText(),
	})
}

/** Whether a webhook delivery is Robert's: `sha256=` HMAC of `timestamp.body` with ROBERT_WEBHOOK_SECRET, within five minutes. */
export function validRobertSignature(timestamp: string | null, signature: string | null, body: string): boolean {
	const secret = process.env.ROBERT_WEBHOOK_SECRET
	if (!secret || !timestamp || !/^\d+$/.test(timestamp) || !signature) return false
	if (Math.abs(Date.now() / 1000 - Number(timestamp)) > SIGNATURE_TOLERANCE_S) return false
	const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`)
	const presented = Buffer.from(signature)
	return expected.length === presented.length && timingSafeEqual(expected, presented)
}

/** Robert's `outcome.set` webhook. Anything else, or a project we never sent, is ignored. */
export async function applyRobertWebhook(body: string): Promise<void> {
	const payload = webhookSchema.parse(JSON.parse(body))
	if (payload.event !== "outcome.set" || !payload.outcome || !payload.projectId) return
	const check = await db.orm.public.TelescreenCheck.where({ robertId: payload.projectId })
		.select("id", "reviewFields", "reviewNote", "trustScore")
		.first()
	if (!check) return
	const { outcome } = payload
	const score = outcome.trustScore ?? null
	const fraud = score !== null && score <= FRAUD_MAX_SCORE
	await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
		outcomeAt: outcome.reviewedAt ?? null,
		outcomeReason: outcome.reason ?? null,
		outcomeStatus: outcome.status ?? null,
		reviewFields: outcome.reviewFields ? json(outcome.reviewFields) : (check.reviewFields ?? undefined),
		reviewNote: fraud ? (outcome.reason ?? null) : check.reviewNote,
		robertState: fraud ? "rejected_fraud" : "decided",
		syncedAt: nowText(),
		trustScore: score ?? check.trustScore,
	})
}

/** Pull every unresolved project's trust score and outcome from Robert. */
export async function syncRobert(): Promise<{ failed: number; updated: number }> {
	const rows = await db.orm.public.TelescreenCheck.where(check => check.robertId.isNotNull())
		.select("id", "robertId", "robertState", "themeProjectId", "trustScore")
		.all()
	const unresolved = new Map(rows.filter(row => UNRESOLVED.has(row.robertState)).map(row => [row.robertId, row]))
	let updated = 0
	let failed = 0
	if (unresolved.size === 0) return { failed, updated }

	for (let offset = 0; ; ) {
		const page = z
			.object({ projects: z.array(z.unknown()), total: z.number() })
			.parse(await robertRequest("GET", `projects?limit=${PAGE_SIZE}&offset=${offset}`))
		for (const raw of page.projects) {
			const parsed = robertProjectSchema.safeParse(raw)
			const check = parsed.success ? unresolved.get(parsed.data.id) : undefined
			if (!parsed.success || !check) continue
			try {
				await applyRobertProject(check, parsed.data)
				updated++
			} catch (err) {
				failed++
				console.error(`[robert] sync failed for ${parsed.data.id}:`, err)
			}
		}
		offset += page.projects.length
		if (page.projects.length === 0 || offset >= page.total) break
	}
	return { failed, updated }
}

/** Spork is slow and rate limited, so it screens one repo at a time across the whole server. */
const sporkSlot = createSlot(1)

/**
 * Screen the project's repo with Spork (`mode: "auto"`, KiCad and STEP). A board takes seconds, a big STEP model a few minutes. The result, or why there is none, is kept on the row.
 */
export async function screenWithSpork(themeProjectId: string): Promise<void> {
	const key = process.env.SPORK_API_KEY
	if (!key) throw new TelescreenError("SPORK_API_KEY must be set")
	const check = await checkFor(themeProjectId)
	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId }).select("githubRepo").first()
	const repo = githubRepoFrom(project?.githubRepo)
	if (!repo) {
		await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
			sporkCheckedAt: nowText(),
			sporkError: "Spork only checks public GitHub repos",
			sporkResult: null,
		})
		return
	}

	const release = await sporkSlot()
	try {
		let response: Response
		try {
			response = await fetch(SPORK_URL, {
				body: JSON.stringify({ mode: "auto", url: `https://github.com/${repo}` }),
				headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "User-Agent": USER_AGENT },
				method: "POST",
				signal: AbortSignal.timeout(SPORK_TIMEOUT_MS),
			})
		} catch (err) {
			throw new TelescreenError(`Spork failed: ${err instanceof Error ? err.message : String(err)}`)
		}
		const text = await response.text()
		if (response.status === 429) throw new TelescreenError("Spork is rate limited", 429)
		if (!response.ok)
			throw new TelescreenError(`Spork failed: ${response.status} ${text.slice(0, 300)}`, response.status)
		const raw: unknown = JSON.parse(text)
		const data = sporkResultSchema.parse(raw)
		const limited = z.object({ errors: z.array(z.looseObject({ statusCode: z.number().nullish() })) }).safeParse(raw)
		if (limited.success && limited.data.errors.some(e => e.statusCode === 429))
			throw new TelescreenError("Spork is rate limited", 429)
		await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
			sporkCheckedAt: nowText(),
			sporkError: null,
			sporkResult: json({ errors: data.errors ?? [], mode: data.mode ?? null, results: data.results ?? [] }),
		})
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
			sporkCheckedAt: nowText(),
			sporkError: message.slice(0, 1000),
		})
		throw err
	} finally {
		release()
	}
}

/** The repos Spork matched as near-identical, from its direct screen and from Robert's, best match per repo first. */
function flaggedMatches(sporkResult: unknown, robertSpork: unknown): ReviewSporkMatch[] {
	const found: ReviewSporkMatch[] = []
	const direct = sporkResultSchema.safeParse(sporkResult)
	if (direct.success)
		for (const result of direct.data.results ?? []) {
			if (result.verdict !== "exclusive_match") continue
			for (const m of result.matches ?? [])
				found.push({
					containment: m.containment ?? null,
					mode: result.mode ?? null,
					repo: m.repo ?? null,
					url: m.url ?? null,
				})
		}
	const robert = robertSporkSchema.safeParse(robertSpork)
	if (robert.success && robert.data.status === "match")
		for (const m of robert.data.matches ?? [])
			found.push({
				containment: m.containment ?? null,
				mode: robert.data.mode ?? null,
				repo: m.repo ?? null,
				url: m.url ?? null,
			})

	const best = new Map<string, ReviewSporkMatch>()
	for (const m of found) {
		const key = (m.url ?? m.repo ?? "").toLowerCase()
		const prev = best.get(key)
		if (!prev || (m.containment ?? 0) > (prev.containment ?? 0)) best.set(key, m)
	}
	return [...best.values()].toSorted((a, b) => (b.containment ?? 0) - (a.containment ?? 0))
}

const flaggedRepos = (matches: ReviewSporkMatch[]): string[] =>
	matches.flatMap(m => (m.repo ? [m.repo.toLowerCase()] : []))

/** A reviewer's call on the project's Spork flag, or null to clear it. It covers the repos flagged when it was made. */
export async function setSporkVerdict(
	themeProjectId: string,
	verdict: SporkVerdict | null,
	byName: string | null,
): Promise<void> {
	const check = await checkFor(themeProjectId)
	const row = await db.orm.public.TelescreenCheck.where({ id: check.id })
		.select("robertSpork", "sporkResult")
		.firstOrThrow()
	await db.orm.public.TelescreenCheck.where({ id: check.id }).update({
		sporkVerdict: verdict
			? json({
					at: new Date().toISOString(),
					by: byName,
					repos: flaggedRepos(flaggedMatches(row.sporkResult, row.robertSpork)),
					verdict,
				})
			: null,
	})
}

/** "Nov 22, 2026 17:31" (UTC), as Fabricate's cards print times. */
function stamp(value: string | null | undefined): string | null {
	if (value === null || value === undefined || value === "") return null
	const at = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? new Date(value) : parseDbTimestamp(value)
	if (Number.isNaN(at.getTime())) return null
	const date = at.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })
	return `${date} ${at.toISOString().slice(11, 16)}`
}

/** What the review screen's Robert and Spork cards show for this project. */
export async function telescreenForReview(themeProjectId: string): Promise<ReviewTelescreen> {
	const row = await db.orm.public.TelescreenCheck.where({ themeProjectId }).first()
	const configured = { robertConfigured: isRobertConfigured(), sporkConfigured: isSporkConfigured() }
	if (!row)
		return { ...configured, matches: [], robert: null, robertSporkSameRepo: false, spork: null, sporkVerdict: null }

	const matches = flaggedMatches(row.sporkResult, row.robertSpork)
	const robertSpork = robertSporkSchema.safeParse(row.robertSpork)
	const fields = z.record(z.string(), z.unknown()).safeParse(row.reviewFields)
	const conflicts = z.array(z.string()).safeParse(row.conflicts)
	const robert: ReviewRobert | null =
		row.robertId || row.robertError
			? {
					conflicts: conflicts.success ? conflicts.data : [],
					creditedHours: row.creditedSeconds === null ? null : Math.round(row.creditedSeconds / 360) / 10,
					error: row.robertError,
					outcomeAt: stamp(row.outcomeAt),
					outcomeReason: row.outcomeReason,
					outcomeStatus: row.outcomeStatus,
					reviewedAt: stamp(row.reviewedAt),
					reviewerName: row.reviewerName,
					reviewFields: fields.success
						? Object.entries(fields.data).flatMap(([k, v]) =>
								typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? [[k, v] as const] : [],
							)
						: [],
					reviewNote: row.reviewNote,
					sentBy: row.sentByName,
					state: row.robertState,
					submittedAt: stamp(row.submittedAt),
					syncedAt: stamp(row.syncedAt),
					trustScore: row.trustScore,
				}
			: null

	const verdict = sporkVerdictSchema.safeParse(row.sporkVerdict)
	// A verdict stands only while it covers every flagged repo: a new match needs a fresh look.
	const sporkVerdict: ReviewSporkVerdict | null =
		verdict.success && flaggedRepos(matches).every(repo => verdict.data.repos.includes(repo))
			? { at: stamp(verdict.data.at), by: verdict.data.by, verdict: verdict.data.verdict }
			: null

	return {
		...configured,
		matches,
		robert,
		robertSporkSameRepo:
			robertSpork.success && robertSpork.data.status === "match" && robertSpork.data.reason === "same_repo",
		spork: row.sporkCheckedAt ? { checkedAt: stamp(row.sporkCheckedAt), error: row.sporkError } : null,
		sporkVerdict,
	}
}

/**
 * The hand-ins still in review that Robert or Spork missed: never sent or screened since the hand-in (a restart can drop the work queued after a response), or failed more than an hour ago. Oldest first.
 */
export async function findUnchecked(): Promise<{ robert: string[]; spork: string[] }> {
	const open = await db.orm.public.PhaseSubmission.where({ resolvedAt: null })
		.select("createdAt", "themeProjectId")
		.orderBy(row => row.createdAt.asc())
		.all()
	const latest = new Map<string, Date>()
	for (const row of open) latest.set(row.themeProjectId, parseDbTimestamp(row.createdAt))
	if (latest.size === 0) return { robert: [], spork: [] }

	const checks = await db.orm.public.TelescreenCheck.where(check => check.themeProjectId.in([...latest.keys()]))
		.select("robertError", "sporkCheckedAt", "sporkError", "submittedAt", "themeProjectId", "updatedAt")
		.all()
	const byProject = new Map(checks.map(check => [check.themeProjectId, check]))
	const hourAgo = Date.now() - 60 * 60_000
	const robert: string[] = []
	const spork: string[] = []
	for (const [themeProjectId, handedIn] of latest) {
		const check = byProject.get(themeProjectId)
		const updated = check ? parseDbTimestamp(check.updatedAt).getTime() : 0
		const failed = (check?.robertError ?? null) !== null
		if (failed ? updated < hourAgo : !check?.submittedAt) robert.push(themeProjectId)
		const screened = check?.sporkCheckedAt ? parseDbTimestamp(check.sporkCheckedAt).getTime() : 0
		if (screened < handedIn.getTime() || (check?.sporkError && screened < hourAgo)) spork.push(themeProjectId)
	}
	return { robert, spork }
}
