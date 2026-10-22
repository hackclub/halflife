import "server-only"
import { Prisma } from "@/app/generated/prisma/client"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit, logAuditTx, requestInfo } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { isIdentityVerified } from "@/lib/hca-profile"
import {
	isHcbConfigured,
	listCardGrantDisbursements,
	memoTransaction,
	parseGrantHashid,
	readCardGrantOwner,
	reconcileDisbursement,
	topUpCardGrant,
	verifiesGrantOwner,
} from "@/lib/hcb"
import prisma from "@/lib/prisma"

/**
 * Send a participant's parts grant to their HCB card grant.
 *
 * Half Life's design approval is what decides the money (`grantUsd`, frozen at approval), and this is the manual way to move it. It is deliberately careful:
 *
 * - one top-up per (user, project, design), enforced by a unique row;
 * - one top-up per card, enforced by a unique index on the grant hashid: the hashid is what identifies the card on HCB's side, and two projects (or two people) pointing at the same card would otherwise each pay it;
 * - the card is checked against the maker before it is paid, because the top-up moves the money as it answers and a grant paid to somebody else's card cannot be recalled;
 * - the maker's Hack Club identity is verified before anything is sent, because a grant is a reward and an unverified account is not eligible for one;
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
 * Whether a Prisma error is the unique index on the grant hashid, rather than the one-per-project key.
 *
 * The two say very different things, and the admin needs to be told which one happened: the project key means this grant has already been claimed for this project, and the hashid index means the card has already been paid for somebody else.
 */
function isDuplicateGrantHashid(err: unknown): boolean {
	if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false
	if (err.code !== "P2002") return false
	const target = err.meta?.target
	if (typeof target === "string") return target.includes("grantHashid")
	if (Array.isArray(target)) return target.some(field => typeof field === "string" && field.includes("grantHashid"))
	return false
}

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
			actorEmail: ctx.adminEmail,
			actorId: ctx.adminId,
			metadata: { memo, memoFailed: true, reason: "HCB returned no transaction id" },
			targetId: ctx.projectId,
			targetType: "ThemeProject",
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
			actorEmail: ctx.adminEmail,
			actorId: ctx.adminId,
			metadata: { error: message, memo, memoFailed: true, transactionId },
			targetId: ctx.projectId,
			targetType: "ThemeProject",
		})
	}
}

/**
 * Mark the row sent and write the audit row that says the money moved, in one transaction.
 *
 * The audit row is the trail of a real HCB money movement, and `logAudit` swallows failures: written after the commit it could be missing entirely and nothing would notice. `logAuditTx` is the variant that refuses, so the trail lands with the record of the payment or neither of them lands.
 */
async function markSentWithAudit(input: {
	adminEmail: string | null
	adminId: string
	amountCents: number
	grantHashid: string
	ownerEmail: string | null
	/** Whether the card was checked against the maker before the money moved. */
	ownerVerified: boolean
	phase: Phase
	projectId: string
	rowId: string
	transactionId: string | null
}): Promise<void> {
	// Read here rather than inside the transaction: `headers()` is request-scoped, and the audit row has to carry the address and browser of the admin who made the payment.
	const { ip, userAgent } = await requestInfo()

	await prisma.$transaction(async tx => {
		await tx.hcbGrantTopUp.update({
			data: { sentAt: new Date(), transactionId: input.transactionId },
			where: { id: input.rowId },
		})
		await logAuditTx(tx, {
			action: AuditAction.ADMIN_SEND_GRANT,
			actorEmail: input.adminEmail,
			actorId: input.adminId,
			ip,
			metadata: {
				amountCents: input.amountCents,
				grantHashid: input.grantHashid,
				// Who HCB says owns the card this went to, so a mismatch is visible in the trail afterwards.
				ownerEmail: input.ownerEmail,
				// Whether the card was checked against the maker BEFORE the money moved. False means the
				// check was turned off for this deployment, not that it passed.
				ownerVerified: input.ownerVerified,
				phase: input.phase,
				transactionId: input.transactionId,
			},
			targetId: input.projectId,
			targetType: "ThemeProject",
			userAgent,
		})
	})
}

export interface SendGrantInput {
	adminEmail: string | null
	adminId: string
	/** The HCB grant link (or bare hashid) an admin pasted. */
	grantUrl: string
	phase: Phase
	themeProjectId: string
}

export interface SendGrantResult {
	/** True when a grant had already been sent for this project and phase. */
	alreadySent: boolean
	amountCents: number
	transactionId: string | null
}

export async function sendGrant(input: SendGrantInput): Promise<SendGrantResult> {
	if (!isHcbConfigured()) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

	// The design approval is the funding decision, and the idempotency key includes the phase – accepting BUILD would send the same frozen grant a second time under a key of its own.
	if (input.phase !== Phase.DESIGN)
		throw new HttpError("VALIDATION_FAILED", "A grant is only sent for an approved design")

	const hashid = parseGrantHashid(input.grantUrl)
	if (!hashid) throw new HttpError("VALIDATION_FAILED", "That is not an HCB grant link")

	const project = await prisma.themeProject.findFirst({
		select: {
			designStatus: true,
			grantUsd: true,
			id: true,
			theme: true,
			tier: true,
			title: true,
			user: { select: { email: true } },
			userId: true,
		},
		where: { deletedAt: null, id: input.themeProjectId },
	})
	if (!project) throw new HttpError("NOT_FOUND", "Project not found")
	if (project.designStatus !== PhaseStatus.approved || !project.grantUsd)
		throw new HttpError("CONFLICT", "A grant is only due on an approved design")

	// A grant is money, so the maker has to have cleared HCA's identity check before any of it is sent. Asked before the HCB row is claimed or the card is read, so an unverified account never starts a payout that would then have to be unwound. `isIdentityVerified` refreshes a stale stored status from HCA and never throws, so an HCA outage refuses rather than pays.
	if (!(await isIdentityVerified(project.userId)))
		throw new HttpError(
			"NOT_VERIFIED",
			"This maker's identity is not verified, so no grant can be sent. Ask them to verify at identity.hackclub.com.",
		)

	const amountCents = Math.round(project.grantUsd * 100)
	const memo = `[grant] ${project.title || "Half Life project"} – Half Life tier ${project.tier ?? "?"}`

	// Who owns the card is settled before it is paid. The top-up moves the money as it answers, so a grant
	// that belongs to somebody else cannot be caught afterwards, and the maker's email is the one identity
	// Half Life and HCB both hold. An owner HCB will not name is not an owner Half Life will pay on trust.
	//
	// HCB only renders another account's email to a token that may read it, so a deployment whose token cannot
	// would refuse every grant. `HCB_VERIFY_GRANT_OWNER=false` turns the check off for such a deployment, and
	// says so in the trail: the payment still happens, and the row records that nobody checked whose card it was.
	const maker = project.user.email.trim().toLowerCase()
	let ownerVerified = false
	if (verifiesGrantOwner()) {
		const owner = await readCardGrantOwner(hashid)
		if (!owner.email)
			throw new HttpError(
				"CONFLICT",
				"HCB would not say who that grant belongs to, so Half Life did not pay it. Check the link, and that the app's HCB token may read the maker's email.",
			)
		if (owner.email !== maker)
			throw new HttpError("CONFLICT", "That HCB grant belongs to a different maker, so Half Life did not pay it")
		ownerVerified = true
	}

	const key = { phase: input.phase, themeProjectId: project.id, userId: project.userId }

	// Claim the slot before HCB is called, so two clicks cannot both send.
	let rowId: string
	try {
		const created = await prisma.hcbGrantTopUp.create({
			data: { ...key, amountCents, createdById: input.adminId, grantHashid: hashid },
			select: { id: true },
		})
		rowId = created.id
	} catch (err) {
		// The card is already paid for another project. That is a different thing from this grant having been
		// claimed already, and the admin needs to hear which one it is.
		if (isDuplicateGrantHashid(err))
			throw new HttpError("CONFLICT", "That HCB card has already been paid for another project")

		const existing = await prisma.hcbGrantTopUp.findUnique({ where: { userId_themeProjectId_phase: key } })
		if (!existing) throw new HttpError("CONFLICT", "Could not start the grant")
		if (existing.sentAt)
			return { alreadySent: true, amountCents: existing.amountCents, transactionId: existing.transactionId }

		// A row with no error normally means a request is running right now, and two of those must not both send. A crash strands a row the same way, so only a row old enough to be abandoned gets past this.
		const ageMs = Date.now() - existing.createdAt.getTime()
		if (existing.error === null && ageMs < ABANDONED_ATTEMPT_MS)
			throw new HttpError("CONFLICT", "A grant for this project is already being sent")

		// Before re-sending, ask HCB what the last attempt left behind. A timeout can lose the response after the top-up applied, and a resend would pay twice; a grant that cannot be read fails closed rather than guessing.
		const disbursements = await listCardGrantDisbursements(existing.grantHashid)
		const reconciled = reconcileDisbursement(disbursements, existing.amountCents, existing.createdAt)

		if (reconciled.kind === "ambiguous")
			throw new HttpError(
				"CONFLICT",
				"Half Life cannot tell whether the previous attempt paid. Check the grant on HCB, then retry once it is clear.",
			)

		if (reconciled.kind === "landed") {
			// The money went to the card the previous attempt used, which is the one the row names – not
			// necessarily the link that was pasted this time. That card's owner is what the trail has to
			// carry, so it is the one that is read here.
			const paidOwner = await readCardGrantOwner(existing.grantHashid)
			await markSentWithAudit({
				adminEmail: input.adminEmail,
				adminId: input.adminId,
				amountCents: existing.amountCents,
				grantHashid: existing.grantHashid,
				ownerEmail: paidOwner.email,
				ownerVerified: paidOwner.email === maker,
				phase: input.phase,
				projectId: project.id,
				rowId: existing.id,
				transactionId: reconciled.transactionId,
			})
			await memoOrReport(reconciled.transactionId, memo, {
				adminEmail: input.adminEmail,
				adminId: input.adminId,
				projectId: project.id,
			})
			// The money has already moved, so this cannot stop it. It says so, loudly, rather than letting a
			// payment to somebody else's card settle quietly into the trail.
			if (paidOwner.email && paidOwner.email !== maker)
				throw new HttpError(
					"CONFLICT",
					"The earlier attempt paid a card that belongs to a different maker. Check HCB before sending anything else.",
				)
			return { alreadySent: true, amountCents: existing.amountCents, transactionId: reconciled.transactionId }
		}

		// Nothing landed, so the retry may claim the row. Comparing `createdAt` makes that a CAS: a concurrent retry bumps it and the loser matches nothing. Refreshing it also restarts the abandoned-attempt window.
		const reclaimed = await reclaimRow(existing.id, existing.createdAt, {
			amountCents,
			createdById: input.adminId,
			grantHashid: hashid,
		})
		if (reclaimed === 0) throw new HttpError("CONFLICT", "A grant for this project is already being sent")
		rowId = existing.id
	}

	// The approval this grant is for can be reversed while HCB is being called. Un-approve refuses while a row like this is in flight (see review.unapprovePhase), so this last read closes the rest of the window.
	const current = await prisma.themeProject.findUnique({
		select: { designStatus: true, grantUsd: true },
		where: { id: project.id },
	})
	if (current?.designStatus !== PhaseStatus.approved || !current.grantUsd) {
		await prisma.hcbGrantTopUp
			.update({ data: { error: "The design was un-approved before the grant was sent" }, where: { id: rowId } })
			.catch(() => undefined)
		throw new HttpError("CONFLICT", "The design is no longer approved, so no grant is due")
	}
	// The amount was captured before HCB was called; if the grant was edited since – including by a retry reclaiming the row above – paying the stale figure sends the wrong money. Fail closed instead.
	if (Math.round(current.grantUsd * 100) !== amountCents) {
		await prisma.hcbGrantTopUp
			.update({ data: { error: "The grant amount changed before the top-up was sent" }, where: { id: rowId } })
			.catch(() => undefined)
		throw new HttpError("CONFLICT", "The grant amount changed – reload and try again")
	}

	try {
		const { ownerEmail, transactionId } = await topUpCardGrant(hashid, amountCents)
		await memoOrReport(transactionId, memo, {
			adminEmail: input.adminEmail,
			adminId: input.adminId,
			projectId: project.id,
		})
		// The trail lands with the record of the payment: one transaction writes the top-up row and the audit
		// row, so a crash between the two cannot leave a real HCB money movement with nothing to show for it.
		await markSentWithAudit({
			adminEmail: input.adminEmail,
			adminId: input.adminId,
			amountCents,
			grantHashid: hashid,
			ownerEmail,
			ownerVerified,
			phase: input.phase,
			projectId: project.id,
			rowId,
			transactionId,
		})
		// The card was checked against the maker before the payment, so this should not happen. It is checked
		// again because the answer came from HCB as well, and if the two disagree the money went somewhere the
		// audit row records. Thrown after the trail was written, so the row is not left saying it failed.
		if (ownerEmail && ownerEmail !== maker)
			throw new HttpError(
				"CONFLICT",
				"The grant was sent, but HCB now reports that card as belonging to somebody else. Check HCB before paying again.",
			)
		return { alreadySent: false, amountCents, transactionId }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		// Only a row that has not been sent yet is a failure. A row that was marked sent says the money moved,
		// and saying otherwise on top of that would send the next attempt looking for a payment that is there.
		await prisma.hcbGrantTopUp
			.updateMany({ data: { error: message }, where: { id: rowId, sentAt: null } })
			.catch(() => undefined)
		throw err
	}
}

/**
 * Take over an existing row for a retry, refusing a card that has already been paid for another project.
 *
 * The compare-and-set is what makes the retry safe: a concurrent retry bumps `createdAt` and the loser matches nothing.
 */
async function reclaimRow(
	rowId: string,
	createdAt: Date,
	data: { amountCents: number; createdById: string; grantHashid: string },
): Promise<number> {
	try {
		const reclaimed = await prisma.hcbGrantTopUp.updateMany({
			data: {
				amountCents: data.amountCents,
				createdAt: new Date(),
				createdById: data.createdById,
				error: null,
				grantHashid: data.grantHashid,
			},
			where: { createdAt, id: rowId, sentAt: null },
		})
		return reclaimed.count
	} catch (err) {
		if (isDuplicateGrantHashid(err))
			throw new HttpError("CONFLICT", "That HCB card has already been paid for another project")
		throw err
	}
}
