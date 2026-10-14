import "server-only"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import {
	isHcbConfigured,
	listCardGrantDisbursements,
	memoTransaction,
	parseGrantHashid,
	reconcileDisbursement,
	topUpCardGrant,
} from "@/lib/hcb"
import prisma from "@/lib/prisma"

/**
 * Send a participant's parts grant to their HCB card grant.
 *
 * Half Life's design approval is what decides the money (`grantUsd`, frozen at approval), and this is the manual way to move it. It is deliberately careful:
 *
 * - one top-up per (user, project, design), enforced by a unique row;
 * - the row is written before HCB is called and marked `sentAt` after, so a crash or a failed call is recoverable rather than silently retried;
 * - a retry asks HCB what the previous attempt left behind before sending again: a timeout can lose the response after the money moved, and a blind resend pays twice;
 * - a failed attempt records its error and may be retried; one still in flight may not, and a row stranded by a crash is treated as in flight
 *     for a while before it may be.
 *
 * Enabling this alongside the Airtable/YSWS payout pipeline would pay twice – that ownership question is a decision, not something this code can settle.
 */

/** How long a row with no error is trusted as a live request rather than a crash. */
export const ABANDONED_ATTEMPT_MS = 10 * 60_000

/**
 * Name the transaction in HCB's books, and make a failure visible.
 *
 * The memo is the only record of why the money moved, and a missing transaction id means HCB committed a top-up it cannot name. Both used to be a console warning, which the failure audit every other outbound effect writes would never show.
 */
async function memoOrReport(
	transactionId: string | null,
	memo: string,
	ctx: { projectId: string; adminId: string | null; adminEmail: string | null },
): Promise<void> {
	if (!transactionId) {
		await logAudit({
			action: AuditAction.ADMIN_SEND_GRANT,
			actorId: ctx.adminId,
			actorEmail: ctx.adminEmail,
			targetType: "ThemeProject",
			targetId: ctx.projectId,
			metadata: { memoFailed: true, reason: "HCB returned no transaction id", memo },
		})
		return
	}
	try {
		await memoTransaction(transactionId, memo)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error("[hcb] memo failed:", err)
		await logAudit({
			action: AuditAction.ADMIN_SEND_GRANT,
			actorId: ctx.adminId,
			actorEmail: ctx.adminEmail,
			targetType: "ThemeProject",
			targetId: ctx.projectId,
			metadata: { memoFailed: true, transactionId, error: message, memo },
		})
	}
}

export type SendGrantInput = {
	themeProjectId: string
	phase: Phase
	/** The HCB grant link (or bare hashid) an admin pasted. */
	grantUrl: string
	adminId: string
	adminEmail: string | null
}

export type SendGrantResult = {
	amountCents: number
	transactionId: string | null
	/** True when a grant had already been sent for this project and phase. */
	alreadySent: boolean
}

export async function sendGrant(input: SendGrantInput): Promise<SendGrantResult> {
	if (!isHcbConfigured()) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

	// The design approval is the funding decision, and the idempotency key includes the phase – accepting BUILD would send the same frozen grant a second time under a key of its own.
	if (input.phase !== Phase.DESIGN)
		throw new HttpError("VALIDATION_FAILED", "A grant is only sent for an approved design")

	const hashid = parseGrantHashid(input.grantUrl)
	if (!hashid) throw new HttpError("VALIDATION_FAILED", "That is not an HCB grant link")

	const project = await prisma.themeProject.findFirst({
		where: { id: input.themeProjectId, deletedAt: null },
		select: { id: true, userId: true, title: true, theme: true, tier: true, grantUsd: true, designStatus: true },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")
	if (project.designStatus !== PhaseStatus.approved || !project.grantUsd)
		throw new HttpError("CONFLICT", "A grant is only due on an approved design")
	const amountCents = Math.round(project.grantUsd * 100)
	const memo = `[grant] ${project.title || "Half Life project"} – Half Life tier ${project.tier ?? "?"}`

	const key = { userId: project.userId, themeProjectId: project.id, phase: input.phase }

	// Claim the slot before HCB is called, so two clicks cannot both send.
	let rowId: string
	try {
		const created = await prisma.hcbGrantTopUp.create({
			data: { ...key, grantHashid: hashid, amountCents, createdById: input.adminId },
			select: { id: true },
		})
		rowId = created.id
	} catch {
		const existing = await prisma.hcbGrantTopUp.findUnique({ where: { userId_themeProjectId_phase: key } })
		if (!existing) throw new HttpError("CONFLICT", "Could not start the grant")
		if (existing.sentAt) {
			return { amountCents: existing.amountCents, transactionId: existing.transactionId, alreadySent: true }
		}

		// A row with no error normally means a request is running right now, and two of those must not both send. A crash strands a row the same way, so only a row old enough to be abandoned gets past this.
		const ageMs = Date.now() - existing.createdAt.getTime()
		if (existing.error === null && ageMs < ABANDONED_ATTEMPT_MS)
			throw new HttpError("CONFLICT", "A grant for this project is already being sent")

		// Before re-sending, ask HCB what the last attempt left behind. A timeout can lose the response after the top-up applied, and a resend would pay twice; a grant that cannot be read fails closed rather than guessing.
		const disbursements = await listCardGrantDisbursements(existing.grantHashid)
		const reconciled = reconcileDisbursement(disbursements, existing.amountCents, existing.createdAt)

		if (reconciled.kind === "ambiguous") {
			throw new HttpError(
				"CONFLICT",
				"Half Life cannot tell whether the previous attempt paid. Check the grant on HCB, then retry once it is clear.",
			)
		}
		if (reconciled.kind === "landed") {
			await prisma.hcbGrantTopUp.update({
				where: { id: existing.id },
				data: { sentAt: new Date(), transactionId: reconciled.transactionId, error: null },
			})
			await memoOrReport(reconciled.transactionId, memo, {
				projectId: project.id,
				adminId: input.adminId,
				adminEmail: input.adminEmail,
			})
			await logAudit({
				action: AuditAction.ADMIN_SEND_GRANT,
				actorId: input.adminId,
				actorEmail: input.adminEmail,
				targetType: "ThemeProject",
				targetId: project.id,
				metadata: {
					phase: input.phase,
					grantHashid: existing.grantHashid,
					amountCents: existing.amountCents,
					transactionId: reconciled.transactionId,
					reconciled: true,
				},
			})
			return { amountCents: existing.amountCents, transactionId: reconciled.transactionId, alreadySent: true }
		}

		// Nothing landed, so the retry may claim the row. Comparing `createdAt` makes that a CAS: a concurrent retry bumps it and the loser matches nothing. Refreshing it also restarts the abandoned-attempt window.
		const reclaimed = await prisma.hcbGrantTopUp.updateMany({
			where: { id: existing.id, sentAt: null, createdAt: existing.createdAt },
			data: { grantHashid: hashid, amountCents, error: null, createdById: input.adminId, createdAt: new Date() },
		})
		if (reclaimed.count === 0) throw new HttpError("CONFLICT", "A grant for this project is already being sent")
		rowId = existing.id
	}

	// The approval this grant is for can be reversed while HCB is being called. Un-approve refuses while a row like this is in flight (see review.unapprovePhase), so this last read closes the rest of the window.
	const current = await prisma.themeProject.findUnique({
		where: { id: project.id },
		select: { designStatus: true, grantUsd: true },
	})
	if (current?.designStatus !== PhaseStatus.approved || !current.grantUsd) {
		await prisma.hcbGrantTopUp
			.update({ where: { id: rowId }, data: { error: "The design was un-approved before the grant was sent" } })
			.catch(() => undefined)
		throw new HttpError("CONFLICT", "The design is no longer approved, so no grant is due")
	}
	// The amount was captured before HCB was called; if the grant was edited since – including by a retry reclaiming the row above – paying the stale figure sends the wrong money. Fail closed instead.
	if (Math.round(current.grantUsd * 100) !== amountCents) {
		await prisma.hcbGrantTopUp
			.update({ where: { id: rowId }, data: { error: "The grant amount changed before the top-up was sent" } })
			.catch(() => undefined)
		throw new HttpError("CONFLICT", "The grant amount changed – reload and try again")
	}

	try {
		const { transactionId } = await topUpCardGrant(hashid, amountCents)
		await memoOrReport(transactionId, memo, {
			projectId: project.id,
			adminId: input.adminId,
			adminEmail: input.adminEmail,
		})
		await prisma.hcbGrantTopUp.update({ where: { id: rowId }, data: { transactionId, sentAt: new Date() } })
		await logAudit({
			action: AuditAction.ADMIN_SEND_GRANT,
			actorId: input.adminId,
			actorEmail: input.adminEmail,
			targetType: "ThemeProject",
			targetId: project.id,
			metadata: { phase: input.phase, grantHashid: hashid, amountCents, transactionId },
		})
		return { amountCents, transactionId, alreadySent: false }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		await prisma.hcbGrantTopUp.update({ where: { id: rowId }, data: { error: message } }).catch(() => undefined)
		throw err
	}
}
