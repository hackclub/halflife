import "server-only"
import { or } from "@prisma/orm-postgres/orm-client"
import { AuditAction, logAuditTx, requestInfo } from "@/lib/audit"
import { displayName } from "@/lib/display-name"
import { HcbGrantCardBatchStatus, HcbGrantCardStatus, PayoutSource, Phase, PhaseStatus, type Theme } from "@/lib/enums"
import { HttpError, messageOf } from "@/lib/errors"
import { grantCardAmountCents, grantCardFingerprint, grantCardPurpose } from "@/lib/grant-card-policy"
import { isIdentityVerified } from "@/lib/hca-profile"
import {
	cancelCardGrant,
	createCardGrant,
	isHcbConfigured,
	listOrganizationCardGrants,
	readOrganizationBalanceCents,
	reconcileCardGrantIssue,
} from "@/lib/hcb"
import db, { type DbOrTx, isUniqueViolation } from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
import { isRecord } from "@/lib/unknown"

/**
 * Issue HCB card grants for approved designs.
 *
 * A design approval is the funding decision, the BOM is the amount, and HCB is the payer. The batch is a snapshot: later approvals wait for the next press of the button, and a project already paid by card grant or by the legacy top-up is never included again.
 */

/** How long a claimed row is trusted as a live request, rather than a crash. */
export const ABANDONED_CARD_ATTEMPT_MS = 10 * 60_000

/** A batch processes a handful at a time, so one request stays inside the route's own timeout. */
export const GRANT_CARD_CHUNK_SIZE = 5

export interface GrantCardProjectRow {
	amountCents: number
	bomLineCount: number
	email: string
	grantUsd: number | null
	ownerId: string
	ownerName: string
	projectId: string
	theme: Theme
	title: string
}

export interface GrantCardExclusion {
	ownerName: string
	projectId: string
	reason: string
	title: string
}

export interface GrantCardPreview {
	balanceCents: number | null
	balanceError: string | null
	canIssue: boolean
	configured: boolean
	eligible: GrantCardProjectRow[]
	excluded: GrantCardExclusion[]
	fingerprint: string
	payoutSource: PayoutSource
	totalCents: number
}

export interface GrantCardOutcome {
	amountCents: number
	error: string | null
	hcbCardGrantId: string | null
	id: string
	projectId: string
	status: HcbGrantCardStatus
	title: string
}

export interface GrantCardBatchSummary {
	ambiguousCount: number
	completedAt: Date | null
	createdAt: Date
	createdById: string | null
	failedCount: number
	id: string
	issuedCount: number
	skippedCount: number
	status: HcbGrantCardBatchStatus
	totalCents: number
}

interface PreviewBuilder {
	eligible: GrantCardProjectRow[]
	excluded: GrantCardExclusion[]
	fingerprint: string
	totalCents: number
}

/**
 * The one project query behind both the preview and the batch snapshot.
 *
 * It is deliberately the same function for both: a preview that priced one set and a create that paid another would be the bug this fingerprint exists to stop.
 */
async function buildPreview(client: DbOrTx): Promise<PreviewBuilder> {
	const rows = await client.orm.public.ThemeProject.where({
		deletedAt: null,
		designStatus: PhaseStatus.approved,
	})
		.select("bomTaxShippingUsd", "designStatus", "grantUsd", "id", "theme", "title", "userId")
		.include("bomItems", items => items.select("quantity", "unitCostUsd"))
		.include("user", user => user.select("displayName", "email", "fraudFlagged", "id", "name", "verificationStatus"))
		.include("hcbGrantCards", cards =>
			cards
				.select("id", "status")
				.where({ phase: Phase.DESIGN })
				.where(card => card.supersededAt.isNull()),
		)
		.include("hcbGrantTopUps", topUps =>
			topUps
				.select("id")
				.where({ phase: Phase.DESIGN })
				.where(topUp => topUp.sentAt.isNotNull()),
		)
		.all()

	const eligible: GrantCardProjectRow[] = []
	const excluded: GrantCardExclusion[] = []
	for (const row of rows) {
		if (!row.user) {
			excluded.push({
				ownerName: "Unknown owner",
				projectId: row.id,
				reason: "Project has no owner",
				title: row.title,
			})
			continue
		}
		const ownerName = displayName(row.user) ?? row.user.name ?? row.user.email
		const liveCard = row.hcbGrantCards.some(
			card =>
				card.status === HcbGrantCardStatus.PENDING
				|| card.status === HcbGrantCardStatus.ISSUED
				|| card.status === HcbGrantCardStatus.AMBIGUOUS,
		)
		const reason = !row.grantUsd
			? "No approved grant"
			: row.user.fraudFlagged
				? "Account is flagged"
				: row.user.verificationStatus !== "verified"
					? "Identity is not verified"
					: row.hcbGrantTopUps.length > 0
						? "Already paid by HCB top-up"
						: liveCard
							? "Card grant already issued or awaiting reconciliation"
							: null
		if (reason) {
			excluded.push({ ownerName, projectId: row.id, reason, title: row.title })
			continue
		}

		const amountCents = grantCardAmountCents(row.bomItems, row.bomTaxShippingUsd)
		if (amountCents <= 0) {
			excluded.push({ ownerName, projectId: row.id, reason: "BOM is empty or totals zero", title: row.title })
			continue
		}

		eligible.push({
			amountCents,
			bomLineCount: row.bomItems.length,
			email: row.user.email,
			grantUsd: row.grantUsd,
			ownerId: row.user.id,
			ownerName,
			projectId: row.id,
			theme: row.theme,
			title: row.title,
		})
	}

	return {
		eligible: eligible.toSorted((a, b) => a.ownerName.localeCompare(b.ownerName) || a.title.localeCompare(b.title)),
		excluded: excluded.toSorted((a, b) => a.ownerName.localeCompare(b.ownerName) || a.title.localeCompare(b.title)),
		fingerprint: grantCardFingerprint(
			eligible.map(row => ({ amountCents: row.amountCents, email: row.email, projectId: row.projectId })),
		),
		totalCents: eligible.reduce((total, row) => total + row.amountCents, 0),
	}
}

/** Everything the admin needs to decide whether to press the button. */
export async function previewCardGrants(): Promise<GrantCardPreview> {
	const settings = await getProgramSettings()
	const preview = await buildPreview(db)
	const configured = isHcbConfigured()
	let balanceCents: number | null = null
	let balanceError: string | null = null
	if (configured)
		try {
			balanceCents = await readOrganizationBalanceCents()
		} catch (err) {
			balanceError = messageOf(err)
		}

	return {
		...preview,
		balanceCents,
		balanceError,
		canIssue:
			settings.payoutSource === PayoutSource.HCB
			&& configured
			&& balanceCents !== null
			&& preview.eligible.length > 0
			&& preview.totalCents > 0
			&& preview.totalCents <= balanceCents,
		configured,
		payoutSource: settings.payoutSource,
	}
}

export interface CreateGrantCardBatchInput {
	admin: { email: string | null; id: string }
	fingerprint: string
}

/** Freeze exactly what the preview showed into one batch, before any money moves. */
export async function createGrantCardBatch(input: CreateGrantCardBatchInput): Promise<{
	batchId: string
	totalCents: number
}> {
	const settings = await getProgramSettings()
	if (settings.payoutSource !== PayoutSource.HCB)
		throw new HttpError("CONFLICT", "Payouts are not set to HCB card grants")
	if (!isHcbConfigured()) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

	const current = await buildPreview(db)
	if (current.eligible.length === 0) throw new HttpError("CONFLICT", "No approved project is ready for a card grant")
	if (current.fingerprint !== input.fingerprint)
		throw new HttpError("CONFLICT", "The list of projects or their BOM totals changed. Reload and try again")
	const balanceCents = await readOrganizationBalanceCents()
	if (current.totalCents > balanceCents)
		throw new HttpError("CONFLICT", "The batch costs more than the HCB balance. Nothing was created")

	const { ip, userAgent } = await requestInfo()
	const result = await db.transaction(async tx => {
		// Recompute inside the transaction too, so a BOM edit between the check above and this write cannot slip through.
		const snapshot = await buildPreview(tx)
		if (snapshot.fingerprint !== input.fingerprint)
			throw new HttpError("CONFLICT", "The list of projects or their BOM totals changed. Reload and try again")
		if (snapshot.eligible.length === 0) throw new HttpError("CONFLICT", "No approved project is ready for a card grant")

		const batch = await tx.orm.public.HcbGrantCardBatch.create({
			createdById: input.admin.id,
			fingerprint: snapshot.fingerprint,
			totalCents: snapshot.totalCents,
		})
		try {
			await tx.orm.public.HcbGrantCard.createAll(
				snapshot.eligible.map(row => ({
					amountCents: row.amountCents,
					batchId: batch.id,
					bomLineCount: row.bomLineCount,
					email: row.email,
					grantUsdCents: row.grantUsd === null ? null : Math.round(row.grantUsd * 100),
					phase: Phase.DESIGN,
					purpose: grantCardPurpose(row.projectId),
					themeProjectId: row.projectId,
					userId: row.ownerId,
				})),
			)
		} catch (err) {
			// A concurrent batch got there first. The partial unique index is what tells us; naming the reason is more useful than a generic conflict.
			if (isUniqueViolation(err)) throw new HttpError("CONFLICT", "Another batch already claimed one of these projects")
			throw err
		}

		await logAuditTx(tx, {
			action: AuditAction.ADMIN_CREATE_GRANT_CARD_BATCH,
			actorEmail: input.admin.email,
			actorId: input.admin.id,
			ip,
			metadata: {
				count: snapshot.eligible.length,
				fingerprint: snapshot.fingerprint,
				totalCents: snapshot.totalCents,
			},
			targetId: batch.id,
			targetType: "HcbGrantCardBatch",
			userAgent,
		})
		return { batchId: batch.id, totalCents: snapshot.totalCents }
	})

	return result
}

export interface ProcessGrantCardBatchInput {
	admin: { email: string | null; id: string }
	batchId: string
	limit?: number
}

export interface ProcessGrantCardBatchResult {
	batch: GrantCardBatchSummary
	outcomes: GrantCardOutcome[]
	remaining: number
}

function hcbStatusOf(err: unknown): number | null {
	if (!(err instanceof HttpError) || !isRecord(err.details)) return null
	const status = err.details.hcbStatus
	return typeof status === "number" ? status : null
}

async function auditIssue(
	tx: DbOrTx,
	input: {
		admin: { email: string | null; id: string }
		amountCents: number
		batchId: string
		cardId: string | null
		grantId: string
		ip: string | null
		projectId: string
		purpose: string
		userAgent: string | null
	},
): Promise<void> {
	await logAuditTx(tx, {
		action: AuditAction.ADMIN_ISSUE_GRANT_CARD,
		actorEmail: input.admin.email,
		actorId: input.admin.id,
		ip: input.ip,
		metadata: {
			amountCents: input.amountCents,
			batchId: input.batchId,
			cardId: input.cardId,
			grantId: input.grantId,
			purpose: input.purpose,
		},
		targetId: input.projectId,
		targetType: "ThemeProject",
		userAgent: input.userAgent,
	})
}

async function markIssued(
	row: { amountCents: number; batchId: string; id: string; projectId: string; purpose: string | null },
	grant: { cardId: string | null; id: string; status: string | null },
	admin: { email: string | null; id: string },
	request: { ip: string | null; userAgent: string | null },
): Promise<void> {
	await db.transaction(async tx => {
		await tx.orm.public.HcbGrantCard.where({ id: row.id }).update({
			cardId: grant.cardId,
			error: null,
			hcbCardGrantId: grant.id,
			hcbStatus: grant.status,
			issuedAt: formatDbTimestamp(new Date()),
			status: HcbGrantCardStatus.ISSUED,
		})
		await auditIssue(tx, {
			admin,
			amountCents: row.amountCents,
			batchId: row.batchId,
			cardId: grant.cardId,
			grantId: grant.id,
			ip: request.ip,
			projectId: row.projectId,
			purpose: row.purpose ?? "",
			userAgent: request.userAgent,
		})
	})
}

async function markSkipped(id: string, reason: string): Promise<void> {
	await db.orm.public.HcbGrantCard.where({ id }).update({
		error: reason,
		status: HcbGrantCardStatus.SKIPPED,
	})
}

async function markFailed(id: string, reason: string): Promise<void> {
	await db.orm.public.HcbGrantCard.where({ id }).update({
		error: reason,
		status: HcbGrantCardStatus.FAILED,
	})
}

async function markAmbiguous(id: string, reason: string): Promise<void> {
	await db.orm.public.HcbGrantCard.where({ id }).update({
		error: reason,
		status: HcbGrantCardStatus.AMBIGUOUS,
	})
}

/**
 * Process the next chunk of a batch.
 *
 * A row is claimed with a compare-and-set before HCB is called, so two requests cannot both pay it. A failed create is never retried in place: the reconciliation below either finds the grant HCB made or leaves the row for a human.
 */
export async function processCardGrantBatch(input: ProcessGrantCardBatchInput): Promise<ProcessGrantCardBatchResult> {
	const settings = await getProgramSettings()
	if (settings.payoutSource !== PayoutSource.HCB)
		throw new HttpError("CONFLICT", "Payouts are not set to HCB card grants")
	if (!isHcbConfigured()) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

	const batch = await db.orm.public.HcbGrantCardBatch.whereUnique({ id: input.batchId }).first()
	if (!batch) throw new HttpError("NOT_FOUND", "Grant card batch not found")

	const limit = Math.min(Math.max(input.limit ?? GRANT_CARD_CHUNK_SIZE, 1), 20)
	const now = new Date()
	const cutoff = new Date(now.getTime() - ABANDONED_CARD_ATTEMPT_MS)
	const candidates = await db.orm.public.HcbGrantCard.where({
		batchId: input.batchId,
		status: HcbGrantCardStatus.PENDING,
	})
		.where(row => or(row.claimedAt.isNull(), row.claimedAt.lt(formatDbTimestamp(cutoff))))
		.orderBy(row => row.createdAt.asc())
		.limit(limit)
		.select(
			"amountCents",
			"batchId",
			"bomLineCount",
			"claimedAt",
			"createdAt",
			"email",
			"id",
			"purpose",
			"themeProjectId",
			"userId",
		)
		.all()

	const { ip, userAgent } = await requestInfo()
	const outcomes: GrantCardOutcome[] = []
	const verified = new Map<string, Promise<boolean>>()
	const isVerified = (userId: string): Promise<boolean> => {
		const cached = verified.get(userId)
		if (cached) return cached
		const pending = isIdentityVerified(userId)
		verified.set(userId, pending)
		return pending
	}

	for (const candidate of candidates) {
		const claimed = await db.orm.public.HcbGrantCard.where({
			id: candidate.id,
			status: HcbGrantCardStatus.PENDING,
		})
			.where(row => or(row.claimedAt.isNull(), row.claimedAt.lt(formatDbTimestamp(cutoff))))
			.updateAndCount({ claimedAt: formatDbTimestamp(now) })
		if (claimed !== 1) continue

		const project = await db.orm.public.ThemeProject.whereUnique({ id: candidate.themeProjectId })
			.select("bomTaxShippingUsd", "deletedAt", "designStatus", "grantUsd", "id", "title", "userId")
			.include("bomItems", items => items.select("quantity", "unitCostUsd"))
			.include("user", user => user.select("email", "fraudFlagged", "id", "name"))
			.first()
		if (!project || project.deletedAt || !project.user) {
			await markSkipped(candidate.id, "Project no longer exists")
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "Project no longer exists", null))
			continue
		}
		if (project.designStatus !== PhaseStatus.approved) {
			await markSkipped(candidate.id, "Design is no longer approved")
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "Design is no longer approved", null))
			continue
		}
		if (!project.grantUsd) {
			await markSkipped(candidate.id, "Project has no approved grant")
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "Project has no approved grant", null))
			continue
		}
		if (project.user.fraudFlagged) {
			await markSkipped(candidate.id, "Account is flagged")
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "Account is flagged", null))
			continue
		}

		const paid = await db.orm.public.HcbGrantTopUp.where({
			phase: Phase.DESIGN,
			themeProjectId: project.id,
		})
			.where(topUp => topUp.sentAt.isNotNull())
			.first()
		if (paid) {
			await markSkipped(candidate.id, "Already paid by HCB top-up")
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "Already paid by HCB top-up", null))
			continue
		}

		const amountCents = grantCardAmountCents(project.bomItems, project.bomTaxShippingUsd)
		if (amountCents !== candidate.amountCents) {
			await markSkipped(candidate.id, "BOM total changed since the batch was made")
			outcomes.push(
				toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "BOM total changed since the batch was made", null),
			)
			continue
		}

		if (!(await isVerified(project.userId))) {
			await markSkipped(candidate.id, "Maker's identity is not verified")
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.SKIPPED, "Maker's identity is not verified", null))
			continue
		}

		const purpose = grantCardPurpose(project.id)

		// A row that was claimed earlier is a previous attempt, not a fresh one. It may have committed at HCB and lost
		// its response, so find out before sending again. Only an attempt known to be absent may proceed to create.
		if (candidate.claimedAt !== null) {
			const previous = await listOrganizationCardGrants().catch(() => null)
			if (!previous) {
				await markAmbiguous(candidate.id, "The earlier attempt could not be checked against HCB")
				outcomes.push(
					toOutcome(
						candidate,
						HcbGrantCardStatus.AMBIGUOUS,
						"The earlier attempt could not be checked against HCB",
						null,
					),
				)
				continue
			}
			const reconciled = reconcileCardGrantIssue(previous, {
				amountCents,
				attemptedAt: parseDbTimestamp(candidate.claimedAt),
				email: project.user.email,
				purpose,
			})
			if (reconciled.kind === "landed") {
				const grant = previous.kind === "listed" ? previous.rows.find(row => row.id === reconciled.grantId) : undefined
				if (grant) {
					await markIssued(
						{ amountCents, batchId: candidate.batchId, id: candidate.id, projectId: project.id, purpose },
						{ cardId: grant.cardId, id: grant.id, status: grant.status },
						input.admin,
						{ ip, userAgent },
					)
					outcomes.push(toOutcome(candidate, HcbGrantCardStatus.ISSUED, null, grant.id))
					continue
				}
			}
			if (reconciled.kind === "ambiguous") {
				await markAmbiguous(candidate.id, "The earlier attempt may have created a grant. Check HCB before retrying")
				outcomes.push(
					toOutcome(
						candidate,
						HcbGrantCardStatus.AMBIGUOUS,
						"The earlier attempt may have created a grant. Check HCB before retrying",
						null,
					),
				)
				continue
			}
		}

		try {
			const grant = await createCardGrant({
				amountCents,
				email: project.user.email,
				instructions: `Parts funding for ${project.title || "your Half Life project"}.`,
				inviteMessage: "Your Half Life parts grant is ready. Accept it to get your card.",
				purpose,
			})
			const responseEmail = grant.email?.trim().toLowerCase()
			if (!responseEmail || responseEmail !== project.user.email.trim().toLowerCase()) {
				// The money has moved. Cancel it if HCB will let us, and never let this look like a clean issue.
				await cancelCardGrant(grant.id).catch(() => undefined)
				await markAmbiguous(
					candidate.id,
					"HCB reported a different owner for this grant. Cancel it on HCB and check before retrying",
				)
				outcomes.push(
					toOutcome(candidate, HcbGrantCardStatus.AMBIGUOUS, "HCB reported a different owner for this grant", grant.id),
				)
				continue
			}

			await markIssued(
				{
					amountCents,
					batchId: candidate.batchId,
					id: candidate.id,
					projectId: project.id,
					purpose,
				},
				{ cardId: grant.cardId, id: grant.id, status: grant.status },
				input.admin,
				{ ip, userAgent },
			)
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.ISSUED, null, grant.id))
		} catch (err) {
			const status = hcbStatusOf(err)
			const message = messageOf(err)
			// A 4xx is HCB refusing the request, not losing its answer. A 5xx, timeout or network failure can have committed.
			if (status !== null && status >= 400 && status < 500) {
				await markFailed(candidate.id, message)
				outcomes.push(toOutcome(candidate, HcbGrantCardStatus.FAILED, message, null))
				continue
			}

			// Ask HCB what the attempt left behind before deciding whether a retry is safe.
			const list = await listOrganizationCardGrants().catch(() => null)
			if (!list) {
				await markAmbiguous(candidate.id, `${message}. HCB could not be read afterwards`)
				outcomes.push(toOutcome(candidate, HcbGrantCardStatus.AMBIGUOUS, message, null))
				continue
			}
			const reconciled = reconcileCardGrantIssue(list, {
				amountCents,
				attemptedAt: parseDbTimestamp(candidate.claimedAt ?? candidate.createdAt),
				email: project.user.email,
				purpose,
			})
			if (reconciled.kind === "landed") {
				const grant = list.kind === "listed" ? list.rows.find(row => row.id === reconciled.grantId) : undefined
				if (grant) {
					await markIssued(
						{
							amountCents,
							batchId: candidate.batchId,
							id: candidate.id,
							projectId: project.id,
							purpose,
						},
						{ cardId: grant.cardId, id: grant.id, status: grant.status },
						input.admin,
						{ ip, userAgent },
					)
					outcomes.push(toOutcome(candidate, HcbGrantCardStatus.ISSUED, null, grant.id))
					continue
				}
			}
			if (reconciled.kind === "absent") {
				await markFailed(candidate.id, `${message}. No matching grant landed`)
				outcomes.push(toOutcome(candidate, HcbGrantCardStatus.FAILED, message, null))
				continue
			}

			await markAmbiguous(candidate.id, `${message}. Check the grant on HCB before retrying`)
			outcomes.push(toOutcome(candidate, HcbGrantCardStatus.AMBIGUOUS, message, null))
		}
	}

	const summary = await refreshBatch(input.batchId)
	return { batch: summary, outcomes, remaining: await remainingCount(input.batchId) }
}

function toOutcome(
	row: { amountCents: number; id: string; themeProjectId: string },
	status: HcbGrantCardStatus,
	error: string | null,
	hcbCardGrantId: string | null,
): GrantCardOutcome {
	return {
		amountCents: row.amountCents,
		error,
		hcbCardGrantId,
		id: row.id,
		projectId: row.themeProjectId,
		status,
		title: "",
	}
}

async function remainingCount(batchId: string): Promise<number> {
	const { count } = await db.orm.public.HcbGrantCard.where({
		batchId,
		status: HcbGrantCardStatus.PENDING,
	}).aggregate(a => ({ count: a.count() }))
	return count
}

async function refreshBatch(batchId: string): Promise<GrantCardBatchSummary> {
	const batch = await db.orm.public.HcbGrantCardBatch.whereUnique({ id: batchId }).first()
	if (!batch) throw new HttpError("NOT_FOUND", "Grant card batch not found")
	const rows = await db.orm.public.HcbGrantCard.where({ batchId }).select("status").all()
	const counts = {
		ambiguous: 0,
		canceled: 0,
		failed: 0,
		issued: 0,
		pending: 0,
		skipped: 0,
	}
	for (const row of rows)
		if (row.status === HcbGrantCardStatus.AMBIGUOUS) counts.ambiguous += 1
		else if (row.status === HcbGrantCardStatus.CANCELED) counts.canceled += 1
		else if (row.status === HcbGrantCardStatus.FAILED) counts.failed += 1
		else if (row.status === HcbGrantCardStatus.ISSUED) counts.issued += 1
		else if (row.status === HcbGrantCardStatus.SKIPPED) counts.skipped += 1
		else counts.pending += 1

	const status =
		counts.pending > 0
			? HcbGrantCardBatchStatus.PROCESSING
			: counts.issued > 0 && counts.failed + counts.ambiguous + counts.skipped + counts.canceled === 0
				? HcbGrantCardBatchStatus.COMPLETED
				: counts.issued > 0
					? HcbGrantCardBatchStatus.PARTIAL
					: HcbGrantCardBatchStatus.FAILED

	const updated = await db.orm.public.HcbGrantCardBatch.where({ id: batchId }).update({
		ambiguousCount: counts.ambiguous,
		completedAt: counts.pending === 0 ? (batch.completedAt ?? formatDbTimestamp(new Date())) : null,
		failedCount: counts.failed,
		issuedCount: counts.issued,
		skippedCount: counts.skipped,
		status,
	})
	if (!updated) throw new HttpError("NOT_FOUND", "Grant card batch not found")
	return toBatchSummary(updated)
}

function toBatchSummary(row: {
	ambiguousCount: number
	completedAt: string | null
	createdAt: string
	createdById: string | null
	failedCount: number
	id: string
	issuedCount: number
	skippedCount: number
	status: HcbGrantCardBatchStatus
	totalCents: number
}): GrantCardBatchSummary {
	return {
		ambiguousCount: row.ambiguousCount,
		completedAt: row.completedAt === null ? null : parseDbTimestamp(row.completedAt),
		createdAt: parseDbTimestamp(row.createdAt),
		createdById: row.createdById,
		failedCount: row.failedCount,
		id: row.id,
		issuedCount: row.issuedCount,
		skippedCount: row.skippedCount,
		status: row.status,
		totalCents: row.totalCents,
	}
}

/** Re-read an ambiguous attempt against HCB. A match is marked issued; no match makes it retryable. */
export async function reconcileGrantCard(
	id: string,
	admin: { email: string | null; id: string },
): Promise<GrantCardOutcome> {
	const row = await db.orm.public.HcbGrantCard.whereUnique({ id }).first()
	if (!row) throw new HttpError("NOT_FOUND", "Card grant not found")
	if (row.status === HcbGrantCardStatus.ISSUED || row.status === HcbGrantCardStatus.CANCELED)
		return toOutcome(row, row.status, row.error, row.hcbCardGrantId)

	const list = await listOrganizationCardGrants()
	const reconciled = reconcileCardGrantIssue(list, {
		amountCents: row.amountCents,
		attemptedAt: parseDbTimestamp(row.claimedAt ?? row.createdAt),
		email: row.email,
		purpose: row.purpose ?? grantCardPurpose(row.themeProjectId),
	})
	if (reconciled.kind === "landed") {
		const grant = list.kind === "listed" ? list.rows.find(candidate => candidate.id === reconciled.grantId) : undefined
		if (!grant) throw new HttpError("CONFLICT", "HCB named a grant Half Life could not read")
		const { ip, userAgent } = await requestInfo()
		await markIssued(
			{
				amountCents: row.amountCents,
				batchId: row.batchId,
				id: row.id,
				projectId: row.themeProjectId,
				purpose: row.purpose,
			},
			{ cardId: grant.cardId, id: grant.id, status: grant.status },
			admin,
			{ ip, userAgent },
		)
		return toOutcome(row, HcbGrantCardStatus.ISSUED, null, grant.id)
	}
	if (reconciled.kind === "absent") {
		await markFailed(row.id, "No matching grant landed. It is safe to retry")
		return toOutcome(row, HcbGrantCardStatus.FAILED, "No matching grant landed. It is safe to retry", null)
	}
	await markAmbiguous(row.id, "More than one matching grant, or HCB could not be read. Check HCB before retrying")
	return toOutcome(
		row,
		HcbGrantCardStatus.AMBIGUOUS,
		"More than one matching grant, or HCB could not be read. Check HCB before retrying",
		null,
	)
}

/** Cancel a live grant and record the refund of its remaining balance. */
export async function cancelGrantCard(
	id: string,
	admin: { email: string | null; id: string },
): Promise<GrantCardOutcome> {
	const row = await db.orm.public.HcbGrantCard.whereUnique({ id }).first()
	if (!row) throw new HttpError("NOT_FOUND", "Card grant not found")
	if (!row.hcbCardGrantId) throw new HttpError("CONFLICT", "This grant has no HCB id to cancel")
	if (row.status === HcbGrantCardStatus.CANCELED)
		return toOutcome(row, HcbGrantCardStatus.CANCELED, row.error, row.hcbCardGrantId)

	await cancelCardGrant(row.hcbCardGrantId)
	const { ip, userAgent } = await requestInfo()
	await db.transaction(async tx => {
		await tx.orm.public.HcbGrantCard.where({ id }).update({
			canceledAt: formatDbTimestamp(new Date()),
			hcbStatus: "canceled",
			status: HcbGrantCardStatus.CANCELED,
		})
		await logAuditTx(tx, {
			action: AuditAction.ADMIN_CANCEL_GRANT_CARD,
			actorEmail: admin.email,
			actorId: admin.id,
			ip,
			metadata: { amountCents: row.amountCents, grantId: row.hcbCardGrantId },
			targetId: row.themeProjectId,
			targetType: "ThemeProject",
			userAgent,
		})
	})
	return toOutcome(row, HcbGrantCardStatus.CANCELED, null, row.hcbCardGrantId)
}

export interface GrantCardBatchDetail extends GrantCardBatchSummary {
	cards: GrantCardOutcome[]
}

export async function getGrantCardBatch(id: string): Promise<GrantCardBatchDetail | null> {
	const row = await db.orm.public.HcbGrantCardBatch.whereUnique({ id }).first()
	if (!row) return null
	const cards = await db.orm.public.HcbGrantCard.where({ batchId: id })
		.orderBy(card => card.createdAt.asc())
		.select("amountCents", "error", "hcbCardGrantId", "id", "status", "themeProjectId")
		.include("themeProject", project => project.select("title"))
		.all()
	return {
		...toBatchSummary(row),
		cards: cards.map(card =>
			Object.assign(toOutcome(card, card.status, card.error, card.hcbCardGrantId), {
				title: card.themeProject?.title ?? "",
			}),
		),
	}
}

export async function listGrantCardBatches(limit = 10): Promise<GrantCardBatchSummary[]> {
	const rows = await db.orm.public.HcbGrantCardBatch.orderBy(batch => batch.createdAt.desc())
		.limit(limit)
		.all()
	return rows.map(toBatchSummary)
}
