import "server-only"
import { Ari, AriApiError, type AriReview, type AriShipInput, type AriWebhookEvent } from "@hackclub/ari"
import type { Prisma } from "@/app/generated/prisma/client"
import { HoursSource, Phase, PhaseStatus, ReviewResult, Theme } from "@/app/generated/prisma/enums"
import { ariExternalId, parseAriExternalId } from "@/lib/ari-id"
import { selectPendingShips } from "@/lib/ari-pending"
import { AuditAction, logAudit } from "@/lib/audit"
import { getThemeDef, WARMUP_THEME } from "@/lib/config/program"
import { isTierId } from "@/lib/config/tiers"
import { HttpError } from "@/lib/errors"
import { notifyReviewOutcome } from "@/lib/notifications"
import prisma from "@/lib/prisma"
import { finalizeReview, reopenPhase, unapprovePhase } from "@/lib/review"
import { sanitize } from "@/lib/sanitize"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * Ari – the external project-review platform.
 *
 * Half Life sends each submitted (project, phase) as an Ari "ship" and receives its decisions back as signed webhooks. The decision is applied through the same `finalizeReview` a human console reviewer calls, so the trail, the ledger and the grant all move exactly once, whether a person or Ari decided. The only difference is attribution: an Ari decision has no Half Life user, so `SubmissionReview.reviewerId` is null and the audit row names Ari instead.
 *
 * Ari owns the YSWS/Airtable row status once a submission is written there, so this integration does not write to Airtable – it mirrors Ari's decision into the participant-facing side of Half Life (status, hours, coins, printer qualification).
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
	if (!isAriConfigured()) {
		throw new HttpError("NOT_CONFIGURED", "Ari is not configured on this deployment")
	}
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

const round2 = (n: number) => Math.round(n * 100) / 100

// Re-exported so callers can treat the Ari integration as one module.
export { ariExternalId, parseAriExternalId }

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
		where: { userId, checkpointKey: `w${buildWeek}-reel-submission`, deletedAt: null },
		orderBy: { createdAt: "desc" },
		select: { objectKey: true },
	})
	return publicUrlFor(reel?.objectKey ?? null)
}

interface ShipBundle {
	input: AriShipInput
	submissionId: string | null
}

async function buildShipInput(themeProjectId: string, phase: Phase): Promise<ShipBundle> {
	const project = await prisma.themeProject.findUnique({
		where: { id: themeProjectId },
		include: {
			user: { select: { email: true, name: true, slackId: true, hackatimeUserId: true } },
			hackatimeLinks: { where: { phase }, select: { hackatimeProject: true } },
			workSessions: {
				where: { phase, deletedAt: null },
				orderBy: { createdAt: "asc" },
				select: {
					title: true,
					content: true,
					hoursClaimed: true,
					hoursSource: true,
					createdAt: true,
					timelapses: { select: { id: true } },
				},
			},
			submissions: {
				orderBy: { createdAt: "desc" },
				select: { id: true, notes: true, resolvedAt: true, phase: true },
			},
		},
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")

	// A retry job snapshots what is pending and sends later; the maker can have unsubmitted in between. The row the decision would land on is gone, so sending would leave an untracked ship in Ari's queue.
	const phaseStatus = phase === Phase.DESIGN ? project.designStatus : project.buildStatus
	if (phaseStatus !== PhaseStatus.in_review) {
		throw new HttpError("NOT_SUBMITTED", "This phase is no longer awaiting review, so there is no ship to send")
	}

	const user = project.user
	if (!project.title.trim()) throw new HttpError("UNPROCESSABLE", "This project has no title to send to Ari")
	if (!project.githubRepo) throw new HttpError("UNPROCESSABLE", "This project has no repository link to send to Ari")
	if (!user.slackId) {
		throw new HttpError("UNPROCESSABLE", "This account has no Slack ID, so Ari cannot be told who the maker is")
	}

	const def = getThemeDef(project.theme)

	const journals = project.workSessions.slice(-200).map((session) => ({
		at: session.createdAt,
		// A HACKATIME_TRACKED entry contributes no time here – its minutes arrive through hackatime_projects – but it is still evidence Ari should see.
		minutes:
			session.hoursSource === HoursSource.HACKATIME_TRACKED
				? 0
				: Math.min(1440, Math.max(0, Math.round(session.hoursClaimed * 60))),
		text: sanitize(session.content ?? session.title) || session.title || "Journal entry",
	}))

	const phaseSubmissions = project.submissions.filter((s) => s.phase === phase)
	const openSubmission = phaseSubmissions.find((s) => s.resolvedAt === null) ?? phaseSubmissions[0] ?? null
	const isUpdate = phaseSubmissions.some((s) => s.resolvedAt !== null)
	const demoUrl = phase === Phase.BUILD ? await buildDemoUrl(project.userId, def.buildWeek) : null
	const hasTimelapse = project.workSessions.some((s) => s.timelapses.length > 0)

	const input: AriShipInput = {
		external_id: ariExternalId(themeProjectId, phase),
		title: project.title,
		// Ari rejects an empty description. Week one's onboarding allows one, and submissions made before that was enforced would otherwise fail every retry, so fall back to the title rather than throw: the title is always present and is a truer description than a placeholder would be.
		description: project.description?.trim() || project.title,
		// Half Life is a hardware programme, so a demo video is optional.
		track: "hardware",
		maker: {
			email: user.email,
			name: user.name?.trim() || user.email,
			slack_id: user.slackId,
			...(user.hackatimeUserId ? { hackatime_id: user.hackatimeUserId } : {}),
			// No `program_hours`: Half Life's time is exactly the journals and Hackatime projects below, which Ari counts itself. Reporting the same hours as program-provided time would make it count them twice.
		},
		repo_url: project.githubRepo,
		thumbnail_url: thumbnailFor(project.coverImageKey, def.slug),
		...(demoUrl ? { demo_url: demoUrl } : {}),
		// Only ask Ari to check elapsed-time evidence when there is a timelapse.
		evidence: hasTimelapse ? ["commits", "devlog", "elapsed"] : ["commits", "devlog"],
		...(project.hackatimeLinks.length > 0
			? { hackatime_projects: project.hackatimeLinks.map((l) => l.hackatimeProject) }
			: {}),
		...(journals.length > 0 ? { journals } : {}),
		meta: {
			program: "half-life",
			theme: def.slug,
			phase: phase === Phase.DESIGN ? "design" : "build",
			week: phase === Phase.DESIGN ? def.designWeek : def.buildWeek,
			requested_tier: project.requestedTier ?? null,
			submission_notes: openSubmission?.notes ?? null,
		},
		...(isUpdate ? { is_update: true, update_message: "Resubmitted after review" } : {}),
	}

	return { input, submissionId: openSubmission?.id ?? null }
}

// ─── Outbound ────────────────────────────────────────────────────────────────

/**
 * Send a hand-in to Ari. Throws on failure so `trackSideEffect` records an ARI_SYNC_FAILURE an operator can replay; the submission keeps a null `ariSubmissionId`, which is what the retry job looks for.
 */
export async function sendSubmissionToAri(themeProjectId: string, phase: Phase) {
	if (!isAriConfigured()) return { skipped: "not_configured" as const }

	const { input, submissionId } = await buildShipInput(themeProjectId, phase)
	const result = await ari().ships.create(input)

	if (submissionId) {
		await prisma.phaseSubmission.update({
			where: { id: submissionId },
			data: { ariSubmissionId: result.id, ariSyncedAt: new Date() },
		})
	}
	return { id: result.id, status: result.status }
}

/** Withdraw an open hand-in from Ari (the participant took it back). */
export async function withdrawSubmissionFromAri(themeProjectId: string, phase: Phase) {
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
 * admin panel. Two queries total rather than two per project, because the
 * admin page renders this on every load. */
export async function findUnsyncedAriSubmissions(): Promise<{ themeProjectId: string; phase: Phase }[]> {
	if (!isAriConfigured()) return []

	const projects = await prisma.themeProject.findMany({
		where: {
			deletedAt: null,
			OR: [{ designStatus: PhaseStatus.in_review }, { buildStatus: PhaseStatus.in_review }],
		},
		select: { id: true, designStatus: true, buildStatus: true },
	})
	if (projects.length === 0) return []

	const open = await prisma.phaseSubmission.findMany({
		where: { themeProjectId: { in: projects.map((p) => p.id) }, resolvedAt: null },
		// Ascending so the newest-per-key tie-break in selectPendingShips sees a stable order when two rows share a millisecond.
		orderBy: { createdAt: "asc" },
		select: { themeProjectId: true, phase: true, ariSubmissionId: true, createdAt: true },
	})
	return selectPendingShips(projects, open)
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
	if (
		typeof review.approved_hours === "number" &&
		Number.isFinite(review.approved_hours) &&
		review.approved_hours >= 0
	) {
		return round2(review.approved_hours)
	}
	if (
		typeof review.approved_minutes === "number" &&
		Number.isFinite(review.approved_minutes) &&
		review.approved_minutes >= 0
	) {
		return round2(review.approved_minutes / 60)
	}
	return null
}

function defaultFeedback(result: ReviewResult): string {
	if (result === ReviewResult.APPROVED) return "Approved by Ari."
	if (result === ReviewResult.RETURNED) return "Ari asked for changes before this can be approved."
	return "Ari rejected this submission."
}

async function ignored(event: AriWebhookEvent, reason: string, externalId: string | null): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		targetType: "ThemeProject",
		targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
		metadata: { event: event.event, reason, externalId },
	})
}

async function applyDecision(event: DecisionEvent): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	if (!parsed) {
		await ignored(event, "unparseable external_id", event.external_id)
		return
	}
	const { themeProjectId, phase } = parsed

	// Prefer the row this ship was actually sent for. A withdraw-and-resubmit reuses the same external id, so a decision for the withdrawn ship must not be applied to the newer hand-in that now holds the open slot.
	const byShip = await prisma.phaseSubmission.findFirst({
		where: { themeProjectId, phase, ariSubmissionId: event.id },
		select: { id: true, ariSubmissionId: true, resolvedAt: true },
	})
	const open =
		byShip ??
		(await prisma.phaseSubmission.findFirst({
			where: { themeProjectId, phase, resolvedAt: null },
			orderBy: { createdAt: "desc" },
			select: { id: true, ariSubmissionId: true, resolvedAt: true },
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
			where: { id: themeProjectId },
			select: { tier: true, requestedTier: true },
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
			where: { id: themeProjectId },
			select: { designStatus: true, theme: true },
		})
		// A warm-up project's only phase is the one the form collected, so there is no design approval to wait for.
		if (project?.theme !== Theme.WARMUP && project?.designStatus !== PhaseStatus.approved) {
			throw new HttpError(
				"DESIGN_NOT_APPROVED",
				"Waiting for the design approval before this build approval can be applied",
			)
		}
	}

	// Ari owns the decision, so a human claim must not block it.
	await prisma.reviewClaim.deleteMany({ where: { submissionId: submission.id } })

	const feedback = event.review.note_to_maker?.trim() || defaultFeedback(result)

	try {
		await finalizeReview({
			submissionId: submission.id,
			reviewerId: null,
			reviewerName: ariReviewerLabel(event.review),
			reviewerEmail: event.review.reviewer?.email ?? null,
			result,
			feedback,
			reason: event.review.audit_note ?? null,
			tier,
			hoursOverride: approvedHoursFrom(event.review),
			grantUsdOverride: null,
		})
	} catch (err) {
		// These mean the decision cannot or need not be applied, and retrying will not change that: the submission is already decided or was withdrawn. A build that arrived before its design is NOT in this list – that one is deferred by state and is rethrown so its delivery stays unrecorded. Anything else (including a claim that reappeared in the tiny window after we cleared it) is rethrown so Ari retries.
		if (err instanceof HttpError && (err.code === "ALREADY_RESOLVED" || err.code === "NOT_SUBMITTED")) {
			await ignored(event, err.code.toLowerCase(), event.external_id)
			return
		}
		throw err
	}

	await prisma.phaseSubmission.update({
		where: { id: submission.id },
		data: { ariSubmissionId: event.id, ariStatus: "reviewed", ariDecision: event.decision },
	})

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		targetType: "ThemeProject",
		targetId: themeProjectId,
		metadata: {
			event: event.event,
			decision: event.decision,
			phase,
			ariSubmissionId: event.id,
			reviewer: event.review.reviewer?.email ?? null,
			approvedHours: approvedHoursFrom(event.review),
		},
	})

	// The decision is committed and recorded; now tell the maker. Best-effort – a Slack or mail outage must not make Ari retry a decided submission, and the project page is the source of truth if a message is missed.
	await notifyReviewOutcome({ themeProjectId, phase, result, feedback })
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
		where: { id: themeProjectId },
		select: { designStatus: true, buildStatus: true },
	})
	if (!project) {
		await ignored(event, "project not found", event.external_id)
		return
	}

	const latest = await prisma.phaseSubmission.findFirst({
		where: { themeProjectId, phase },
		orderBy: { createdAt: "desc" },
		select: { id: true, ariSubmissionId: true },
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
	if (status === PhaseStatus.approved) {
		await unapprovePhase(themeProjectId, phase, null, null, reason)
	} else if (status === PhaseStatus.rejected) {
		await reopenPhase(themeProjectId, phase, null, null, reason)
	}

	await prisma.$transaction(async (tx) => {
		await tx.submissionReview.updateMany({
			where: { submission: { themeProjectId, phase }, invalidated: false },
			data: { invalidated: true, invalidatedAt: new Date() },
		})
		await tx.phaseSubmission.update({
			where: { id: latest.id },
			data: { resolvedAt: null, resolvedResult: null, ariStatus: "review", ariDecision: null },
		})
		await tx.themeProject.update({
			where: { id: themeProjectId },
			data: phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : { buildStatus: PhaseStatus.in_review },
		})
	})

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		targetType: "ThemeProject",
		targetId: themeProjectId,
		metadata: { event: event.event, phase, undone: status },
	})
}

/** An optional post-approval fraud check. A failure flags the maker. */
async function applyFraud(event: FraudEvent): Promise<void> {
	const parsed = parseAriExternalId(event.external_id)
	let userId: string | null = null
	if (parsed) {
		const project = await prisma.themeProject.findUnique({
			where: { id: parsed.themeProjectId },
			select: { userId: true },
		})
		userId = project?.userId ?? null
	}

	if (event.fraud.verdict === "failed" && userId) {
		await prisma.user.update({ where: { id: userId }, data: { fraudFlagged: true } })
	}

	await logAudit({
		action: AuditAction.ARI_WEBHOOK_APPLIED,
		targetType: "ThemeProject",
		targetId: parsed?.themeProjectId ?? null,
		metadata: {
			event: event.event,
			verdict: event.fraud.verdict,
			checks: event.fraud.checks.length,
			flagged: event.fraud.verdict === "failed",
		},
	})
}

async function applyShipUpdated(event: UpdatedEvent): Promise<void> {
	await logAudit({
		action: AuditAction.ARI_WEBHOOK_IGNORED,
		targetType: "ThemeProject",
		targetId: parseAriExternalId(event.external_id)?.themeProjectId ?? null,
		metadata: {
			event: event.event,
			// Mapped to plain values: the SDK's interface has no index signature, so it is not itself assignable to Prisma's JSON input type.
			changes: event.changes.map((change) => ({
				field: change.field,
				old_value: change.old_value,
				new_value: change.new_value,
			})),
			editedBy: event.edited_by?.email ?? null,
		},
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
	const seen = await prisma.ariWebhookDelivery.findUnique({ where: { deliveryId }, select: { id: true } })
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
					deliveryId,
					event: event.event,
					ariSubmissionId,
					externalId,
					payload: event as unknown as Prisma.InputJsonValue,
				},
			})
			await logAudit({
				action: AuditAction.ARI_WEBHOOK_IGNORED,
				targetType: "ThemeProject",
				targetId: externalId ? (parseAriExternalId(externalId)?.themeProjectId ?? null) : null,
				metadata: { event: event.event, reason: "deferred: design not approved", externalId, deferred: true },
			})
			return
		}
		throw err
	}

	await prisma.ariWebhookDelivery.create({
		data: { deliveryId, event: event.event, ariSubmissionId, externalId },
	})
}
