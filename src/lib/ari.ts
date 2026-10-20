import "server-only"
import {
	Ari,
	AriApiError,
	AriInputError,
	type AriReview,
	type AriShipInput,
	type AriShipStatus,
	type AriWebhookEvent,
} from "@hackclub/ari"
import type { Prisma } from "@/app/generated/prisma/client"
import { HoursSource, Phase, PhaseStatus, ReviewResult, Theme } from "@/app/generated/prisma/enums"
import { mirrorReviewDecision, reviewStatusFor, reviewStatusForResult } from "@/lib/airtable/sync"
import { ariExternalId, parseAriExternalId } from "@/lib/ari-id"
import { selectPendingShips } from "@/lib/ari-pending"
import { type StandingDecision, standingDecision } from "@/lib/ari-standing"
import { AuditAction, logAudit } from "@/lib/audit"
import { getThemeDef, WARMUP_THEME } from "@/lib/config/program"
import { isTierId } from "@/lib/config/tiers"
import { HttpError } from "@/lib/errors"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { round2 } from "@/lib/money"
import { notifyReviewOutcome, notifyShipFailed } from "@/lib/notifications"
import prisma from "@/lib/prisma"
import { normalizeRepo } from "@/lib/repo"
import { finalizeReview, reopenPhase, unapprovePhase } from "@/lib/review"
import { sanitize } from "@/lib/sanitize"
import { DEFAULT_SESSION_TITLE } from "@/lib/schemas/session"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * Ari – the external project-review platform.
 *
 * Half Life sends each submitted (project, phase) as an Ari "ship" and receives its decisions back as signed webhooks. The decision is applied through the same `finalizeReview` a human console reviewer calls, so the trail, the ledger and the grant all move exactly once, whether a person or Ari decided. The only difference is attribution: an Ari decision has no Half Life user, so `SubmissionReview.reviewerId` is null and the audit row names Ari instead.
 *
 * Ari owns the decision, and it is mirrored into the participant-facing side of Half Life (status, hours, coins, printer qualification). The one thing written back to Airtable is the decision itself – `Loops - halfLifeReviewStatus` and `Loops - halfLifeReviewerNotes`, which Loops reads to email the maker. A decision writes nothing to the base on its own, so both are put on the row here (see `mirrorReviewDecision`).
 *
 * Everything here no-ops when the three ARI_* secrets are unset, so local dev and any deployment that has not been onboarded to Ari behave as before.
 */

export function isAriConfigured(): boolean {
	return Boolean(process.env.ARI_PROGRAM_ID && process.env.ARI_SIGNING_SECRET)
}

export function isAriWebhookConfigured(): boolean {
	return Boolean(process.env.ARI_WEBHOOK_SECRET)
}

/**
 * The absolute webhook URL to paste into the Ari program settings.
 *
 * Configured origin first: behind an ingress the request's own host is the internal one, and a webhook URL the Ari service cannot reach is one that silently never fires. The caller may pass the request origin as a fallback
 * for local development.
 */
export function ariWebhookUrl(originFallback = ""): string {
	const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? originFallback).replace(/\/$/, "")
	return `${base}/api/integrations/ari/webhook`
}

let client: Ari | null = null

function ari(): Ari {
	if (!isAriConfigured()) throw new HttpError("NOT_CONFIGURED", "Ari is not configured on this deployment")
	const programId = process.env.ARI_PROGRAM_ID
	const signingSecret = process.env.ARI_SIGNING_SECRET
	if (!programId || !signingSecret) throw new Error("Ari is not configured on this deployment")
	client ??= new Ari({
		programId,
		signingSecret,
		...(process.env.ARI_BASE_URL ? { baseUrl: process.env.ARI_BASE_URL } : {}),
	})
	return client
}

// Re-exported so callers can treat the Ari integration as one module.
export { ariExternalId, parseAriExternalId } from "@/lib/ari-id"

// ─── Building the ship ───────────────────────────────────────────────────────

function appUrl(): string {
	return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")
}

/**
 * Ari requires a thumbnail. Prefer the project's own cover; fall back to the theme painting the participant already saw for that week, so a project without a cover is still reviewable rather than silently unsendable. A warm-up project has no theme painting – it was never part of the season – so it falls back to the programme's build artwork rather than a 404.
 */
function thumbnailFor(coverImageKey: string | null, slug: string): string {
	const cover = publicUrlFor(coverImageKey)
	if (cover) return cover
	return slug === WARMUP_THEME.slug ? `${appUrl()}/art/build.png` : `${appUrl()}/brand/themes/${slug}.png`
}

/** The build's closing reel, or null – hardware projects may omit a demo. */
async function buildDemoUrl(userId: string, buildWeek: number): Promise<string | null> {
	const reel = await prisma.post.findFirst({
		orderBy: { createdAt: "desc" },
		select: { objectKey: true },
		where: { checkpointKey: `w${buildWeek}-reel-submission`, deletedAt: null, userId },
	})
	return publicUrlFor(reel?.objectKey ?? null)
}

/**
 * What a journal that is only recordings says to a reviewer.
 *
 * The journal form asks for words or timelapses, and an entry with only the latter used to reach Ari titled "Work session" with no text at all – indistinguishable from an entry where the maker forgot to write anything. Naming the situation and its clip count lets the reviewer judge the footage on its own instead of reading silence as a gap.
 */
const emptyTimelapseSession = (timelapses: number): string =>
	`[This is an empty work session with ${timelapses} timelapse${timelapses === 1 ? "" : "s"} attached.]`

/**
 * Whether an entry carries no words of its own, leaving only the title column's "Work session" placeholder.
 *
 * Exported for the backfill that replaces ships already in Ari: a ship cannot be updated in place, so the script finds the entries whose text this rule rewrites.
 */
export function isWordlessJournal(content: string | null, title: string): boolean {
	const storedTitle = sanitize(title)
	return !sanitize(content ?? "") && (!storedTitle || storedTitle === DEFAULT_SESSION_TITLE)
}

interface ShipBundle {
	input: AriShipInput
	submissionId: string | null
}

async function buildShipInput(themeProjectId: string, phase: Phase): Promise<ShipBundle> {
	const project = await prisma.themeProject.findUnique({
		include: {
			hackatimeLinks: { select: { hackatimeProject: true }, where: { phase } },
			submissions: {
				orderBy: { createdAt: "desc" },
				select: { id: true, notes: true, phase: true, resolvedAt: true },
			},
			user: { select: { email: true, hackatimeUserId: true, name: true, slackId: true } },
			workSessions: {
				orderBy: { createdAt: "asc" },
				select: {
					content: true,
					createdAt: true,
					hoursClaimed: true,
					hoursSource: true,
					timelapses: {
						select: {
							externalId: true,
							hackatimeProject: true,
							objectKey: true,
							playbackUrl: true,
							provider: true,
						},
					},
					title: true,
				},
				where: { deletedAt: null, phase },
			},
		},
		where: { id: themeProjectId },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	// A retry job snapshots what is pending and sends later; the maker can have unsubmitted in between. The row the decision would land on is gone, so sending would leave an untracked ship in Ari's queue.
	const phaseStatus = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (phaseStatus !== PhaseStatus.in_review)
		throw new HttpError("NOT_SUBMITTED", "This phase is no longer awaiting review, so there is no ship to send")

	const user = project.user
	if (!project.title.trim()) throw new HttpError("UNPROCESSABLE", "This project has no title to send to Ari")
	if (!project.githubRepo) throw new HttpError("UNPROCESSABLE", "This project has no repository link to send to Ari")
	if (!user.slackId)
		throw new HttpError("UNPROCESSABLE", "This account has no Slack ID, so Ari cannot be told who the maker is")

	// Ari validates `repo_url` as an absolute http(s) URL, and the stored link is not always one: the project form enforces that, but the warm-up importers write `githubRepo` straight from a spreadsheet cell, where a maker is as likely to have typed `github.com/me/thing` with the scheme left off. `normalizeRepo` is the same rule the repo field itself applies, so a link that would have saved fine had it been typed on the project page is sent rather than failing the whole ship – and one that will not parse is refused here, naming the link, instead of coming back from Ari as a bare field error that leaves the project retrying on the hour with nothing an operator can act on.
	const repoUrl = normalizeRepo(project.githubRepo).url
	if (!repoUrl)
		throw new HttpError(
			"UNPROCESSABLE",
			`This project's repo link is not a web address, so it cannot be sent to Ari: ${project.githubRepo}`,
		)

	const def = getThemeDef(project.theme)

	const journals = project.workSessions.slice(-200).map(session => {
		const clips = session.timelapses.flatMap(t => {
			const url =
				t.provider === "lapse" && t.externalId
					? lapseTimelapseUrl(t.externalId)
					: (t.playbackUrl ?? publicUrlFor(t.objectKey))
			return url ? [url] : []
		})
		// An entry can be a recording and nothing else: the maker attached a timelapse and logged the time without writing a word, so the stored title is the "Work session" placeholder. Sent as-is that reads as a blank entry to Ari, as if the work were missing rather than recorded, so say what the entry actually is – the clip links below are its evidence.
		const written = sanitize(session.content ?? "")
		const body =
			isWordlessJournal(session.content, session.title) && clips.length > 0
				? emptyTimelapseSession(clips.length)
				: written || sanitize(session.title) || "Journal entry"
		return Object.assign(
			{
				at: session.createdAt,
				// A HACKATIME_TRACKED entry contributes no time here – its minutes arrive through hackatime_projects – but it is still evidence Ari should see.
				minutes:
					session.hoursSource === HoursSource.HACKATIME_TRACKED
						? 0
						: Math.min(1440, Math.max(0, Math.round(session.hoursClaimed * 60))),
				text: body,
			},
			// Ari has no field for a journal's own attachments: its Lapse tile pulls clips per Hackatime project. Linking each recording in the entry keeps it attached to the journal it backs even when that pull has nothing to match (no Hackatime id, or a project Lapse never named), so a reviewer never opens an entry with no evidence in it.
			clips.length > 0
				? {
						markdown: [
							body,
							...clips.map((url, index) => `[Timelapse${clips.length > 1 ? ` ${index + 1}` : ""}](${url})`),
						].join("\n\n"),
					}
				: {},
		)
	})

	const phaseSubmissions = project.submissions.filter(s => s.phase === phase)
	const openSubmission = phaseSubmissions.find(s => s.resolvedAt === null) ?? phaseSubmissions[0] ?? null
	const isUpdate = phaseSubmissions.some(s => s.resolvedAt !== null)
	const demoUrl = phase === Phase.BUILD ? await buildDemoUrl(project.userId, def.buildWeek) : null
	const hasTimelapse = project.workSessions.some(s => s.timelapses.length > 0)
	// Ari fetches Lapse clips per Hackatime project key, so a recording's own project has to be named even when the maker never linked it to this phase. Linked projects first, then the ones only a timelapse names, deduped and capped at Ari's limit.
	const hackatimeProjects = [
		...new Set([
			...project.hackatimeLinks.map(l => l.hackatimeProject),
			...project.workSessions.flatMap(s => s.timelapses.flatMap(t => (t.hackatimeProject ? [t.hackatimeProject] : []))),
		]),
	].slice(0, 50)

	const input: AriShipInput = {
		// Ari rejects an empty description. Week one's onboarding allows one, and submissions made before that was enforced would otherwise fail every retry, so fall back to the title rather than throw: the title is always present and is a truer description than a placeholder would be.
		description: project.description?.trim() || project.title,
		external_id: ariExternalId(themeProjectId, phase),
		maker: {
			email: user.email,
			name: user.name?.trim() || user.email,
			slack_id: user.slackId,
			...(user.hackatimeUserId ? { hackatime_id: user.hackatimeUserId } : {}),
			// No `program_hours`: Half Life's time is exactly the journals and Hackatime projects below, which Ari counts itself. Reporting the same hours as program-provided time would make it count them twice.
		},
		repo_url: repoUrl,
		thumbnail_url: thumbnailFor(project.coverImageKey, def.slug),
		title: project.title,
		// Half Life is a hardware programme, so a demo video is optional.
		track: "hardware",
		...(demoUrl ? { demo_url: demoUrl } : {}),
		// Only ask Ari to check elapsed-time evidence when there is a timelapse.
		evidence: hasTimelapse ? ["commits", "devlog", "elapsed"] : ["commits", "devlog"],
		...(hackatimeProjects.length > 0 ? { hackatime_projects: hackatimeProjects } : {}),
		...(journals.length > 0 ? { journals } : {}),
		meta: {
			phase: phase === Phase.DESIGN ? "design" : "build",
			program: "half-life",
			requested_tier: project.requestedTier ?? null,
			submission_notes: openSubmission?.notes ?? null,
			theme: def.slug,
			week: phase === Phase.DESIGN ? def.designWeek : def.buildWeek,
		},
		...(isUpdate ? { is_update: true, update_message: "Resubmitted after review" } : {}),
	}

	return { input, submissionId: openSubmission?.id ?? null }
}

// ─── Outbound ────────────────────────────────────────────────────────────────

/**
 * A send failure a retry cannot fix, as the reason to tell the maker, or null when retrying may still work.
 *
 * Two sources, and they are the whole set. The guards in `buildShipInput` refuse a hand-in we already know Ari will not take - no title, no repo link, a link that is not a web address, an account with no Slack id. The SDK's own `validateShip` refuses the rest of its field rules before it ever opens a request. Neither changes on its own, so replaying them hourly is the retry job talking to itself.
 *
 * Everything else - a timeout, a 5xx, a rate limit - is left alone: those are what the retry is for, and a notice on each would turn a brief Ari outage into mail to everyone mid-hand-in.
 */
function terminalShipFailure(err: unknown): string | null {
	if (err instanceof HttpError && err.code === "UNPROCESSABLE") return err.message
	if (err instanceof AriInputError) return err.message
	return null
}

/**
 * Write down a send that a retry cannot fix, and tell the maker the first time it happens.
 *
 * The marker is what makes the notice once per stuck hand-in rather than once per hour: `ari-retry` replays every unsent hand-in, and the row it would re-read held nothing until the first terminal failure. A later success clears it, and unsubmitting deletes the row, so a fresh hand-in earns a fresh notice.
 *
 * Never throws. It runs on the way out of a send that has already failed, and swallowing its own trouble is what lets that failure keep travelling to `trackSideEffect`, where it becomes the audit row an operator replays.
 */
async function noteShipFailure(themeProjectId: string, phase: Phase, reason: string): Promise<void> {
	try {
		const submission = await prisma.phaseSubmission.findFirst({
			orderBy: { createdAt: "desc" },
			select: { ariShipError: true, id: true },
			where: { phase, resolvedAt: null, themeProjectId },
		})
		if (!submission) return

		const firstTime = submission.ariShipError === null
		await prisma.phaseSubmission.update({ data: { ariShipError: reason }, where: { id: submission.id } })
		if (!firstTime) return

		await notifyShipFailed({ phase, reason, themeProjectId })
	} catch (err) {
		console.error(`[ari] could not record the ship failure for ${themeProjectId}:`, err)
	}
}

/**
 * Send a hand-in to Ari. Throws on failure so `trackSideEffect` records an ARI_SYNC_FAILURE an operator can replay; the submission keeps a null `ariSubmissionId`, which is what the retry job looks for.
 */
export async function sendSubmissionToAri(
	themeProjectId: string,
	phase: Phase,
): Promise<{ skipped: "not_configured" } | { id: string; status: "accepted" | "duplicate" }> {
	if (!isAriConfigured()) return { skipped: "not_configured" as const }

	try {
		const { input, submissionId } = await buildShipInput(themeProjectId, phase)
		const result = await ari().ships.create(input)

		if (submissionId)
			await prisma.phaseSubmission.update({
				// The error is cleared with the send: a hand-in that reached Ari is not stuck, and the marker is only ever about the current attempt.
				data: { ariShipError: null, ariSubmissionId: result.id, ariSyncedAt: new Date() },
				where: { id: submissionId },
			})

		return { id: result.id, status: result.status }
	} catch (err) {
		const reason = terminalShipFailure(err)
		if (reason) await noteShipFailure(themeProjectId, phase, reason)
		throw err
	}
}

/** Withdraw an open hand-in from Ari (the participant took it back). */
export async function withdrawSubmissionFromAri(
	themeProjectId: string,
	phase: Phase,
): Promise<{ skipped: "not_configured" } | { status: "withdrawn" | "not_queued" }> {
	if (!isAriConfigured()) return { skipped: "not_configured" as const }
	try {
		const result = await ari().ships.withdraw(ariExternalId(themeProjectId, phase))
		return { status: result.status }
	} catch (err) {
		// Already gone is the state we wanted; only a real failure should retry.
		if (err instanceof AriApiError && err.code === "not_queued") return { status: "not_queued" as const }
		throw err
	}
}

/** Hand-ins awaiting review that never reached Ari – for the retry job and the
 * admin panel. Three queries total rather than several per project, because the
 * admin page renders this on every load. */
export async function findUnsyncedAriSubmissions(): Promise<
	{ themeProjectId: string; phase: Phase; reason: string | null }[]
> {
	if (!isAriConfigured()) return []

	const projects = await prisma.themeProject.findMany({
		select: { buildStatus: true, designStatus: true, id: true },
		where: {
			deletedAt: null,
			OR: [{ designStatus: PhaseStatus.in_review }, { buildStatus: PhaseStatus.in_review }],
		},
	})
	if (projects.length === 0) return []

	const open = await prisma.phaseSubmission.findMany({
		// Ascending so the newest-per-key tie-break in selectPendingShips sees a stable order when two rows share a millisecond.
		orderBy: { createdAt: "asc" },
		select: { ariSubmissionId: true, createdAt: true, phase: true, themeProjectId: true },
		where: { resolvedAt: null, themeProjectId: { in: projects.map(p => p.id) } },
	})
	const pending = selectPendingShips(projects, open)
	if (pending.length === 0) return []

	// Why each one is stuck: the last send failure, so the panel reads "no Slack account" rather than a row to blindly retry. Withdraw failures are a different operation and live on the same action, so they are skipped here. Capped rather than per-pair queried; beyond a few hundred recent failures the oldest pairs fall back to "not attempted", which the next failure corrects.
	const failures = await prisma.auditLog.findMany({
		orderBy: { createdAt: "desc" },
		select: { metadata: true, targetId: true },
		take: 500,
		where: { action: AuditAction.ARI_SYNC_FAILURE, targetId: { in: pending.map(p => p.themeProjectId) } },
	})
	const reasonOf = (themeProjectId: string, phase: Phase): string | null => {
		const meta = failures.find(failure => {
			if (failure.targetId !== themeProjectId) return false
			const data =
				typeof failure.metadata === "object" && failure.metadata !== null && !Array.isArray(failure.metadata)
					? (failure.metadata as { [_: string]: unknown })
					: null
			if (!data || "withdrawn" in data || data.phase !== phase) return false
			return true
		})?.metadata as { error?: unknown } | null
		return typeof meta?.error === "string" ? meta.error : null
	}
	return pending.map(item => Object.assign({}, item, { reason: reasonOf(item.themeProjectId, item.phase) }))
}

// ─── Inbound ─────────────────────────────────────────────────────────────────

type DecisionEvent = Extract<AriWebhookEvent, { event: "review.approved" | "review.changes" | "review.rejected" }>
type ResetEvent = Extract<AriWebhookEvent, { event: "review.reverted" | "review.requeued" }>
type FraudEvent = Extract<AriWebhookEvent, { event: "review.fraud" }>
type UpdatedEvent = Extract<AriWebhookEvent, { event: "ship.updated" }>
type UnknownEvent = Extract<AriWebhookEvent, { event: "unknown" }>

function ariReviewerLabel(review: AriReview): string {
	return review.reviewer?.email ?? "Ari"
}

/** Ari's approved time is authoritative; fall back to its minutes breakdown. */
function approvedHoursFrom(review: AriReview): number | null {
	if (typeof review.approved_hours === "number" && Number.isFinite(review.approved_hours) && review.approved_hours >= 0)
		return round2(review.approved_hours)

	if (
		typeof review.approved_minutes === "number"
		&& Number.isFinite(review.approved_minutes)
		&& review.approved_minutes >= 0
	)
		return round2(review.approved_minutes / 60)

	return null
}

/**
 * The words a decision falls back to when the reviewer wrote no note.
 *
 * `finalizeReview` needs something to show, so the stored review and the project page carry this; the maker's notice and the row's `Loops - halfLifeReviewerNotes` column deliberately carry nothing instead (see the callers). Exported because the review-status backfill has to recognise this fallback to reconstruct that empty note rather than quote the sentence the maker already read as the headline.
 */
export function defaultFeedback(result: ReviewResult): string {
	if (result === ReviewResult.APPROVED) return "Approved by Ari."
	if (result === ReviewResult.RETURNED) return "Ari asked for changes before this can be approved."
	return "Ari rejected this submission."
}

async function ignored(event: AriWebhookEvent, reason: string, externalId: string | null): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		metadata: { event: event.event, externalId, reason },
		targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
		targetType: "ThemeProject",
	})
}

async function applyDecision(event: DecisionEvent, opts: { announce?: boolean } = {}): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	if (!parsed) {
		await ignored(event, "unparseable external_id", event.external_id)
		return
	}
	const { themeProjectId, phase } = parsed

	// Prefer the row this ship was actually sent for. A withdraw-and-resubmit reuses the same external id, so a decision for the withdrawn ship must not be applied to the newer hand-in that now holds the open slot.
	const byShip = await prisma.phaseSubmission.findFirst({
		select: { ariSubmissionId: true, id: true, resolvedAt: true },
		where: { ariSubmissionId: event.id, phase, themeProjectId },
	})
	const open =
		byShip
		?? (await prisma.phaseSubmission.findFirst({
			orderBy: { createdAt: "desc" },
			select: { ariSubmissionId: true, id: true, resolvedAt: true },
			where: { phase, resolvedAt: null, themeProjectId },
		}))
	if (!open) {
		await ignored(event, "no open submission for this phase", event.external_id)
		return
	}
	if (!byShip && open.ariSubmissionId && open.ariSubmissionId !== event.id) {
		await ignored(event, "decision names an earlier ship of this phase", event.external_id)
		return
	}
	const submission = open

	const result =
		event.event === "review.approved"
			? ReviewResult.APPROVED
			: event.event === "review.changes"
				? ReviewResult.RETURNED
				: ReviewResult.REJECTED

	// A design approval is also the funding decision: it sets the tier and the parts grant. Ari reviews the work, not the money, so the tier is the one the maker asked for – never invented here.
	let tier: number | null = null
	if (result === ReviewResult.APPROVED && phase === Phase.DESIGN) {
		const project = await prisma.themeProject.findUnique({
			select: { requestedTier: true, tier: true },
			where: { id: themeProjectId },
		})
		const chosen = project?.tier ?? project?.requestedTier ?? null
		if (!chosen || !isTierId(chosen)) {
			await ignored(event, "design approved but no valid funding tier is set", event.external_id)
			return
		}
		tier = chosen
	}

	// A build cannot be approved before its design is. Ari reviews each phase on its own clock – and Half Life deliberately lets a build be submitted before its design is approved, so a build approval arriving first is expected, not an error. It is a decision deferred by state, so throw: the delivery is not recorded and Ari redelivers it, which is what eventually applies it once the design is approved. Checked before the claim is cleared so a deferred redelivery does not keep deleting a human reviewer's claim.
	if (result === ReviewResult.APPROVED && phase === Phase.BUILD) {
		const project = await prisma.themeProject.findUnique({
			select: { designStatus: true, theme: true },
			where: { id: themeProjectId },
		})
		// A warm-up project's only phase is the one the form collected, so there is no design approval to wait for.
		if (project?.theme !== Theme.WARMUP && project?.designStatus !== PhaseStatus.approved)
			throw new HttpError(
				"DESIGN_NOT_APPROVED",
				"Waiting for the design approval before this build approval can be applied",
			)
	}

	// Ari owns the decision, so a human claim must not block it.
	await prisma.reviewClaim.deleteMany({ where: { submissionId: submission.id } })

	const feedback = event.review.note_to_maker?.trim() || defaultFeedback(result)
	// The note without the fallback above: it is the reviewer's own words, and an invented one would say the headline twice wherever it is quoted – the Slack DM and the row's Loops column.
	const makerNote = event.review.note_to_maker?.trim() || null

	try {
		await finalizeReview({
			feedback,
			grantExtension: opts.announce !== false,
			grantUsdOverride: null,
			hoursOverride: approvedHoursFrom(event.review),
			reason: event.review.audit_note ?? null,
			result,
			reviewerEmail: event.review.reviewer?.email ?? null,
			reviewerId: null,
			reviewerName: ariReviewerLabel(event.review),
			submissionId: submission.id,
			tier,
		})
	} catch (err) {
		// A decision that lands after a status pass already applied it, carrying the reviewer's own words the pass never had: replace the placeholder instead of discarding the delivery. Ari's review screen resends a decision exactly this way, and the resent delivery is the only thing that ever carries the note.
		if (err instanceof HttpError && err.code === "ALREADY_RESOLVED" && makerNote) {
			const adopted = await adoptStatusPlaceholder({
				auditNote: event.review.audit_note?.trim() || null,
				note: makerNote,
				phase,
				result,
				reviewerEmail: event.review.reviewer?.email ?? null,
				submissionId: submission.id,
				themeProjectId,
			})
			if (adopted) {
				await logAudit({
					action: AuditAction.ARI_WEBHOOK_APPLIED,
					metadata: { event: event.event, late: true, phase },
					targetId: themeProjectId,
					targetType: "ThemeProject",
				})
				// Quiet, like the status pass that applied the decision: a backlog of resends must not become a flood of late DMs, and the maker was already sent the page's state when the decision landed. The review row, the review trail and the project page now carry the reviewer's words; `airtable:backfill-review` pushes them on to the row.
				return
			}
		}

		// These mean the decision cannot or need not be applied, and retrying will not change that: the submission is already decided or was withdrawn. A build that arrived before its design is NOT in this list – that one is deferred by state and is rethrown so its delivery stays unrecorded. Anything else (including a claim that reappeared in the tiny window after we cleared it) is rethrown so Ari retries.
		if (err instanceof HttpError && (err.code === "ALREADY_RESOLVED" || err.code === "NOT_SUBMITTED")) {
			await ignored(event, err.code.toLowerCase(), event.external_id)
			return
		}
		throw err
	}

	await prisma.phaseSubmission.update({
		data: { ariDecision: event.decision, ariStatus: "reviewed", ariSubmissionId: event.id },
		where: { id: submission.id },
	})

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		metadata: {
			approvedHours: approvedHoursFrom(event.review),
			ariSubmissionId: event.id,
			decision: event.decision,
			event: event.event,
			phase,
			reviewer: event.review.reviewer?.email ?? null,
		},
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})

	// The row carries the decision too, for Loops. Best-effort like the notice below: the review is already committed, and a decided submission must not be redelivered over a base that is briefly unreachable.
	//
	// A reconciliation that replays a backlog skips both this and the notice below: the maker is told once, by the live webhook, and a run that decided hundreds of old hand-ins at once must not turn into hundreds of late messages. The Airtable backfill mirrors the state afterwards instead.
	if (opts.announce !== false)
		await mirrorReviewDecision(themeProjectId, phase, reviewStatusForResult(result), makerNote)

	// The decision is committed and recorded; now tell the maker. Best-effort – a Slack outage must not make Ari retry a decided submission, and the project page is the source of truth if a message is missed.
	if (opts.announce !== false)
		await notifyReviewOutcome({
			decidedBy: "ari",
			// Ari's own note, not the fallback: `feedback` above has already been defaulted so the review row and the project page always have something to show, and quoting that back to the maker as "the reviewer's note" says the headline twice and tells them nothing they can act on.
			note: makerNote,
			phase,
			result,
			themeProjectId,
		})
}

/**
 * Undo a result Ari removed. Reverses local status and credit, marks the reviews invalid, and puts the phase back in front of reviewers so it can be decided again. Safe to run more than once.
 */
async function applyReset(event: ResetEvent): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	if (!parsed) {
		await ignored(event, "unparseable external_id", event.external_id)
		return
	}
	const { themeProjectId, phase } = parsed

	const project = await prisma.themeProject.findUnique({
		select: { buildStatus: true, designStatus: true },
		where: { id: themeProjectId },
	})
	if (!project) {
		await ignored(event, "project not found", event.external_id)
		return
	}

	const latest = await prisma.phaseSubmission.findFirst({
		orderBy: { createdAt: "desc" },
		select: { ariSubmissionId: true, id: true },
		where: { phase, themeProjectId },
	})
	if (!latest) {
		await ignored(event, "no submission to requeue", event.external_id)
		return
	}
	// The same stale-ship rule as a decision: reopening a newer hand-in because Ari reverted an older one would erase a review it never saw.
	if (latest.ariSubmissionId && latest.ariSubmissionId !== event.id) {
		await ignored(event, "reset names an earlier ship of this phase", event.external_id)
		return
	}

	const status = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	const reason = `Ari ${event.event === "review.requeued" ? "requeued" : "reverted"} the review`
	if (status === PhaseStatus.approved) await unapprovePhase(themeProjectId, phase, null, null, reason)
	else if (status === PhaseStatus.rejected) await reopenPhase(themeProjectId, phase, null, null, reason)

	await prisma.$transaction(async tx => {
		await tx.submissionReview.updateMany({
			data: { invalidated: true, invalidatedAt: new Date() },
			where: { invalidated: false, submission: { phase, themeProjectId } },
		})
		await tx.phaseSubmission.update({
			data: { ariDecision: null, ariStatus: "review", resolvedAt: null, resolvedResult: null },
			where: { id: latest.id },
		})
		await tx.themeProject.update({
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review },
			where: { id: themeProjectId },
		})
	})

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		metadata: { event: event.event, phase, undone: status },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})

	// The phase is back with the maker – unapproving and reopening both land on `update_requested`, and a phase already in front of reviewers stays there – so the row follows the state rather than being reset to "Pending Review", which the project would not be in. The note goes with the decision it belonged to: it is cleared, so an email for whatever comes next cannot quote words that no longer stand.
	const after =
		status === PhaseStatus.approved || status === PhaseStatus.rejected ? PhaseStatus.update_requested : status
	await mirrorReviewDecision(themeProjectId, phase, reviewStatusFor(after), null)
}

/** An optional post-approval fraud check. A failure flags the maker. */
async function applyFraud(event: FraudEvent): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	let userId: string | null = null
	if (parsed) {
		const project = await prisma.themeProject.findUnique({
			select: { userId: true },
			where: { id: parsed.themeProjectId },
		})
		userId = project?.userId ?? null
	}

	if (event.fraud.verdict === "failed" && userId)
		await prisma.user.update({ data: { fraudFlagged: true }, where: { id: userId } })

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		metadata: {
			checks: event.fraud.checks.length,
			event: event.event,
			flagged: event.fraud.verdict === "failed",
			verdict: event.fraud.verdict,
		},
		targetId: parsed?.themeProjectId ?? null,
		targetType: "ThemeProject",
	})
}

async function applyShipUpdated(event: UpdatedEvent): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		metadata: {
			// Mapped to plain values: the SDK's interface has no index signature, so it is not itself assignable to Prisma's JSON input type.
			changes: event.changes.map(change => ({
				field: change.field,
				new_value: change.new_value,
				old_value: change.old_value,
			})),
			editedBy: event.edited_by?.email ?? null,
			event: event.event,
		},
		targetId: parseAriExternalId(event.external_id)?.themeProjectId ?? null,
		targetType: "ThemeProject",
	})
}

async function applyUnknown(event: UnknownEvent): Promise<void> {
	// Recorded so a new Ari event is visible, then dropped: it will be handled once the SDK and this handler know it.
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		metadata: { event: event.event, eventName: event.event_name },
	})
}

async function applyEvent(event: AriWebhookEvent): Promise<void> {
	switch (event.event) {
		case "review.approved":
		case "review.changes":
		case "review.rejected":
			await applyDecision(event)
			break
		case "review.reverted":
		case "review.requeued":
			await applyReset(event)
			break
		case "review.fraud":
			await applyFraud(event)
			break
		case "ship.updated":
			await applyShipUpdated(event)
			break
		case "unknown":
			await applyUnknown(event)
			break
	}
}

/**
 * Apply an event that was stored because the state was not ready for it – a build approval that arrived before its design. Called by the `ari-retry` job; the caller marks the delivery applied once this resolves.
 */
export async function applyStoredEvent(event: AriWebhookEvent): Promise<void> {
	await applyEvent(event)
}

/**
 * Apply one verified Ari webhook.
 *
 * Idempotent: the delivery id is checked first and recorded only after the work succeeds, so a redelivery (same id) is a no-op and a failed one is retried by Ari. A decision the state is not ready for is stored whole instead (see below) and replayed by `ari-retry`, so it does not depend on Ari's redelivery window outlasting the wait.
 *
 * Errors are rethrown so the route answers non-2xx.
 */
export async function applyAriWebhook(event: AriWebhookEvent, deliveryId: string): Promise<void> {
	const seen = await prisma.ariWebhookDelivery.findUnique({ select: { id: true }, where: { deliveryId } })
	if (seen) return

	const externalId = "external_id" in event ? event.external_id : null
	const ariSubmissionId = "id" in event ? event.id : null

	try {
		await applyEvent(event)
	} catch (err) {
		// "Not yet", not "never": the design has to be approved before a build approval can be applied, and that ordering is normal here. Keep the whole event so the retry job can apply it later, and accept the delivery rather than asking Ari to redeliver indefinitely.
		if (err instanceof HttpError && err.code === "DESIGN_NOT_APPROVED") {
			await prisma.ariWebhookDelivery.create({
				data: {
					ariSubmissionId,
					deliveryId,
					event: event.event,
					externalId,
					payload: event as unknown as Prisma.InputJsonValue,
				},
			})
			await logAudit({
				action: AuditAction.ARI_WEBHOOK_IGNORED,
				metadata: { deferred: true, event: event.event, externalId, reason: "deferred: design not approved" },
				targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
				targetType: "ThemeProject",
			})
			return
		}
		throw err
	}

	await prisma.ariWebhookDelivery.create({
		data: { ariSubmissionId, deliveryId, event: event.event, externalId },
	})
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

/** What a reconciliation pass did. The job and the manual backfill report the same shape. */
export interface ReconcileSummary {
	/** Hand-ins whose standing decision was applied. */
	applied: number
	/** Open hand-ins examined at Ari. */
	checked: number
	/** Open hand-ins Ari reports a final decision for. */
	decided: number
	/** Builds held back because their design is not approved yet – applied by a later pass. */
	deferred: number
	/** Status reads or applications that errored; retried next pass. */
	failed: number
	/** Hand-ins Ari still holds open. */
	pending: number
	/** Decided ships whose newest ship is not this hand-in (withdrawn and resubmitted). */
	skipped: number
}

/**
 * A ship's status, plus the final review the endpoint carries.
 *
 * `AriShipStatus` describes only the decision, which is why a reconciled decision used to reach the maker with no note to show (see `decisionEventFromStatus`). Ari's status response includes the review that carried the decision – its `note_to_maker` and `reviewer` – so the shape is declared here and read defensively: a response that omits `review` still applies the decision with the generic note it always did. Drop this and read `AriShipStatus.review` once `@hackclub/ari`'s own type carries it.
 */
interface AriShipStatusWithReview extends AriShipStatus {
	review?: {
		audit_note?: string | null
		note_to_maker?: string
		reviewer?: { email?: string | null } | null
	} | null
}

/**
 * A decision as the webhook names it, built from a ship's standing state.
 *
 * `ari.ships.status` reports the decision and the review's own words, but not the approved hours: an approval's hours come from the local hours roll-up, so a replayed approval is paid on Half Life's figure rather than Ari's. The note and the reviewer are read off the status when it carries them, so a decision applied here reaches the maker with the same sentence the webhook would have delivered instead of Ari's generic fallback; a response without a review still falls back to that sentence. This remains a recovery path for a delivery that never arrived, not the normal one.
 */
function decisionEventFromStatus(status: AriShipStatusWithReview, standing: StandingDecision): DecisionEvent {
	// The union discriminates on the decision, so each arm is built whole rather than spread from a common base – a spread would widen `event` and `decision` into independent unions the type no longer correlates.
	const maker = { email: "", name: "", slack_id: null }
	const note = status.review?.note_to_maker?.trim() ?? ""
	const reviewerEmail = status.review?.reviewer?.email ?? null
	const review = { note_to_maker: note, reviewer: reviewerEmail ? { email: reviewerEmail, slack_id: null } : null }
	const ship = {
		authors: [],
		demo_url: null,
		description: null,
		hackatime_projects: [],
		repo_url: "",
		thumbnail_url: null,
		title: "",
		track: "hardware" as const,
	}
	if (standing.decision === "approved")
		return {
			decision: "approved",
			event: "review.approved",
			external_id: status.external_id,
			id: status.id,
			maker,
			review,
			ship,
		}
	if (standing.decision === "changes")
		return {
			decision: "changes",
			event: "review.changes",
			external_id: status.external_id,
			id: status.id,
			maker,
			review,
			ship,
		}
	return {
		decision: "rejected",
		event: "review.rejected",
		external_id: status.external_id,
		id: status.id,
		maker,
		review,
		ship,
	}
}

/**
 * Replay decisions Ari holds but the webhook never delivered.
 *
 * The webhook is the only path a decision normally takes into Half Life, and it is fire-and-forget: Ari signs each delivery, but a delivery sent while the endpoint was misconfigured, unregistered or unreachable is simply gone. The ship still carries its result at Ari, though, so this asks `ari.ships.status` for each open hand-in and applies whatever final decision it finds through the same `applyDecision` the webhook calls – so the ledger, the tier and the phase all move exactly as they would have.
 *
 * Candidates are the open hand-ins the site still believes are in review – the same set `getAdminCounters` calls live hand-ins, and the same set a decision would have resolved. They are examined in a shuffled order and a capped run takes only the first `limit` of them: a fixed prefix would starve the rest once the older ones turned out to be genuinely pending, because the same few would be re-read on every run and the tail never reached. Rotation means a capped job still covers everything over enough runs. Re-running is safe: a hand-in the previous pass resolved is no longer open, and `finalizeReview` refuses one that is.
 *
 * `commit` false reports what it would apply and writes nothing, which is what the backfill script defaults to. `announce` is off by default: a backlog replay can decide hundreds of hand-ins at once, and the maker is told by the live webhook in the normal case – turning a recovery run into hundreds of late Slack DMs and Loops emails is not the intent. Read `docs/RUNBOOK.md` before announcing a bulk run.
 */
export async function reconcileAriDecisions(
	opts: { announce?: boolean; commit?: boolean; limit?: number } = {},
): Promise<ReconcileSummary> {
	const summary: ReconcileSummary = {
		applied: 0,
		checked: 0,
		decided: 0,
		deferred: 0,
		failed: 0,
		pending: 0,
		skipped: 0,
	}
	if (!isAriConfigured()) return summary

	const candidates = await prisma.phaseSubmission.findMany({
		select: { ariSubmissionId: true, phase: true, themeProjectId: true },
		where: {
			ariSubmissionId: { not: null },
			OR: [
				{ phase: Phase.DESIGN, themeProject: { designStatus: PhaseStatus.in_review } },
				{ phase: Phase.BUILD, themeProject: { buildStatus: PhaseStatus.in_review } },
			],
			resolvedAt: null,
			themeProject: { deletedAt: null },
		},
	})
	// Shuffled rather than ordered: see the header. Sort keys are only for the shuffle and carry no meaning.
	const open = candidates
		.map(value => ({ order: Math.random(), value }))
		.toSorted((a, b) => a.order - b.order)
		.slice(0, opts.limit ?? 2000)
		.map(entry => entry.value)

	for (const submission of open) {
		summary.checked += 1

		let status: AriShipStatusWithReview
		try {
			status = await ari().ships.status({ external_id: ariExternalId(submission.themeProjectId, submission.phase) })
		} catch (err) {
			summary.failed += 1
			console.error(`[ari] reconcile: status failed for ${submission.themeProjectId}:${submission.phase}`, err)
			continue
		}

		const standing = standingDecision(status)
		if (!standing) {
			summary.pending += 1
			continue
		}
		summary.decided += 1
		if (!opts.commit) continue

		// Ari reports the newest ship for the external id. When that is not the ship this hand-in was sent as, the hand-in was withdrawn and resubmitted and the decision names the older ship – left alone, exactly as the webhook leaves it.
		if (submission.ariSubmissionId !== null && submission.ariSubmissionId !== status.id) {
			summary.skipped += 1
			continue
		}

		try {
			await applyDecision(decisionEventFromStatus(status, standing), { announce: opts.announce === true })
			summary.applied += 1
		} catch (err) {
			// A build approved before its design is expected here: it is deferred by state, not failed, and the next pass applies it once the design lands.
			if (err instanceof HttpError && err.code === "DESIGN_NOT_APPROVED") {
				summary.deferred += 1
				continue
			}
			summary.failed += 1
			console.error(
				`[ari] reconcile: could not apply ${standing.decision} for ${submission.themeProjectId}:${submission.phase}`,
				err,
			)
		}
	}

	return summary
}

// ─── Repairing a decision the status pass rebuilt ────────────────────────────

/** What a repair pass did. */
export interface RepairSummary {
	/** Placeholder reviews examined. */
	checked: number
	/** Status reads that errored; retried on a later run. */
	failed: number
	/** Standing decisions Ari has no note for – the fallback is genuinely all there is. */
	quiet: number
	/** Placeholders rewritten with the reviewer's words (`commit` only). */
	repaired: number
	/** Placeholders whose ship has moved on or is not the one this review decided. */
	skipped: number
	/** Placeholders Ari still answers for with the same final decision. */
	standing: number
}

/** The decision a stored result names, in Ari's vocabulary. */
function decisionForResult(result: ReviewResult): StandingDecision["decision"] {
	if (result === ReviewResult.APPROVED) return "approved"
	if (result === ReviewResult.REJECTED) return "rejected"
	return "changes"
}

/** Whether a stored review is the placeholder a status pass leaves: no reviewer, and the generic sentence for its result. */
function isStatusPlaceholder(
	review: { feedback: string; reviewerEmail: string | null; reviewerId: string | null },
	result: ReviewResult,
): boolean {
	return review.reviewerId === null && review.reviewerEmail === null && review.feedback === defaultFeedback(result)
}

/**
 * Replace the sentence a status pass left with the reviewer's own words, when a real delivery arrives after it.
 *
 * A status pass has no note to record (see `decisionEventFromStatus`), so a decision applied that way is stored with `defaultFeedback` and no reviewer. Ari's review screen resends the decision as an ordinary delivery, and that delivery is the only thing carrying the note; without this it would be turned away as already-decided and the words thrown away. Only a placeholder is rewritten – a review with its own feedback, or one attributed to a console reviewer, is the record of a real decision and stays as it is. Returns whether anything was written.
 */
async function adoptStatusPlaceholder(input: {
	auditNote: string | null
	note: string
	phase: Phase
	result: ReviewResult
	reviewerEmail: string | null
	submissionId: string
	themeProjectId: string
}): Promise<boolean> {
	const review = await prisma.submissionReview.findFirst({
		orderBy: { createdAt: "desc" },
		select: { feedback: true, id: true, reviewerEmail: true, reviewerId: true },
		where: { invalidated: false, result: input.result, submissionId: input.submissionId },
	})
	if (!review || !isStatusPlaceholder(review, input.result)) return false

	await writeStatusReviewNote({
		auditNote: input.auditNote,
		note: input.note,
		phase: input.phase,
		result: input.result,
		reviewerEmail: input.reviewerEmail,
		reviewId: review.id,
		themeProjectId: input.themeProjectId,
	})
	return true
}

/**
 * Write a decision's own words back over the sentence the status pass left there.
 *
 * The review row is the record of the decision, so it is rewritten regardless of what came after; the project's standing comment is replaced only while it still shows the fallback, so a newer decision's words are never overwritten by a repair of an older one.
 */
async function writeStatusReviewNote(input: {
	auditNote: string | null
	note: string
	phase: Phase
	result: ReviewResult
	reviewId: string
	reviewerEmail: string | null
	themeProjectId: string
}): Promise<void> {
	await prisma.$transaction(async tx => {
		await tx.submissionReview.update({
			data: {
				feedback: input.note,
				...(input.auditNote ? { reason: input.auditNote } : {}),
				reviewerEmail: input.reviewerEmail,
				// Ari names a decision by the reviewer's address, so the label follows the address exactly as the webhook path does (see `ariReviewerLabel`).
				reviewerName: input.reviewerEmail ?? "Ari",
			},
			where: { id: input.reviewId },
		})

		const project = await tx.themeProject.findUnique({
			select: { buildReviewComments: true, designReviewComments: true },
			where: { id: input.themeProjectId },
		})
		const current = input.phase === Phase.DESIGN ? project?.designReviewComments : project?.buildReviewComments
		if (current !== defaultFeedback(input.result)) return

		await tx.themeProject.update({
			data: input.phase === Phase.DESIGN ? { designReviewComments: input.note } : { buildReviewComments: input.note },
			where: { id: input.themeProjectId },
		})
	})
}

/**
 * Give a decision the status pass rebuilt the reviewer's words it should have had.
 *
 * `reconcileAriDecisions` applies a decision from `ari.ships.status`, and a response that carries only the decision leaves the review row and the project page showing `defaultFeedback` in place of the note. When the status response includes the final review, a decision already applied can be repaired here: the review's `feedback` (and the audit `reason`) and the project's standing comment are replaced with Ari's own words, and the reviewer is named.
 *
 * Ari's status response does not carry the review today (see the [webhooks docs](https://ari.hackclub.com/docs/webhooks#status): `id`, `external_id`, `version`, `phase` and `decision` only), so a pass over current decisions reports every placeholder as `quiet` – there is no note to read. Until the endpoint is extended, the same repair happens as a side effect of a resend: Ari's review screen resends the decision as an ordinary delivery, and `adoptStatusPlaceholder` rewrites the placeholder from the webhook the moment it arrives.
 *
 * Only a review the status pass rebuilt is touched – `reviewerId` and `reviewerEmail` are both null and the feedback is exactly `defaultFeedback` of its result, which is a shape no person and no delivered webhook ever produces. A placeholder whose ship no longer answers with the same final decision, or whose newest ship is not the one this review decided, is left alone rather than rewritten from another state.
 *
 * Read-only unless `commit`, so a run reports what it would repair. This is a one-off for the decisions applied before the status response carried a review; `reconcileAriDecisions` keeps new ones correct on its own.
 */
export async function repairStatusDecisions(opts: { commit?: boolean; limit?: number } = {}): Promise<RepairSummary> {
	const summary: RepairSummary = { checked: 0, failed: 0, quiet: 0, repaired: 0, skipped: 0, standing: 0 }
	if (!isAriConfigured()) return summary

	const placeholders = (
		await prisma.submissionReview.findMany({
			orderBy: { createdAt: "asc" },
			select: {
				feedback: true,
				id: true,
				result: true,
				reviewerEmail: true,
				reviewerId: true,
				submission: { select: { ariSubmissionId: true, phase: true, themeProjectId: true } },
			},
			where: {
				invalidated: false,
				reviewerEmail: null,
				reviewerId: null,
				// Without a ship id there is nothing to ask Ari about, and the decision never came from it.
				submission: { ariSubmissionId: { not: null } },
			},
		})
	).filter(review => isStatusPlaceholder(review, review.result))

	const stubs = placeholders.slice(0, opts.limit ?? placeholders.length)
	summary.checked = stubs.length

	for (const review of stubs) {
		const { ariSubmissionId, phase, themeProjectId } = review.submission

		let status: AriShipStatusWithReview
		try {
			status = await ari().ships.status({ external_id: ariExternalId(themeProjectId, phase) })
		} catch (err) {
			summary.failed += 1
			console.error(`[ari] repair: status failed for ${themeProjectId}:${phase}`, err)
			continue
		}

		// The misread cases: a ship Ari no longer holds final, a decision that changed since, or the newest ship not being the one this review decided. The record is left as it stands rather than rewritten from a ship it never judged.
		const standing = standingDecision(status)
		if (!standing || standing.decision !== decisionForResult(review.result) || ariSubmissionId !== status.id) {
			summary.skipped += 1
			continue
		}
		summary.standing += 1

		const note = status.review?.note_to_maker?.trim() ?? ""
		if (!note) {
			summary.quiet += 1
			continue
		}
		if (!opts.commit) continue

		await writeStatusReviewNote({
			auditNote: status.review?.audit_note?.trim() || null,
			note,
			phase,
			result: review.result,
			reviewerEmail: status.review?.reviewer?.email ?? null,
			reviewId: review.id,
			themeProjectId,
		})
		summary.repaired += 1
	}

	return summary
}
