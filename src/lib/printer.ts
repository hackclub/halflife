import "server-only"
import type { PrinterAward, Prisma } from "@/app/generated/prisma/client"
import { PhaseStatus, type PrinterAwardStatus, type Theme } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { THEMES, THEMES_REQUIRED_FOR_PRINTER } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { decryptUserPII, encryptPII, isPiiConfigured } from "@/lib/pii"
import { canMovePrinterAward, PRINTER_AWARD_LABELS } from "@/lib/printer-award"
import prisma from "@/lib/prisma"

export interface ThemeProgress {
	build: boolean
	design: boolean
	shipped: boolean
	theme: Theme
}

export interface PrinterQualification {
	progress: ThemeProgress[]
	qualified: boolean
	required: number
	shippedCount: number
}

/**
 * Always derived from ThemeProject state, never read from PrinterAward.
 *
 * Keeping eligibility and fulfilment separate means an un-approval after the award surfaces as a mismatch an admin resolves, rather than silently revoking a printer that is already in a box.
 */
export async function getPrinterQualification(userId: string): Promise<PrinterQualification> {
	const projects = await prisma.themeProject.findMany({
		select: { buildReviewedAt: true, buildStatus: true, designStatus: true, theme: true },
		where: { deletedAt: null, userId },
	})
	const byTheme = new Map(projects.map(p => [p.theme, p]))

	const progress: ThemeProgress[] = THEMES.map(def => {
		const p = byTheme.get(def.id)
		const design = p?.designStatus === PhaseStatus.approved
		const build = p?.buildStatus === PhaseStatus.approved
		return { build, design, shipped: design && build, theme: def.id }
	})

	const shippedCount = progress.filter(p => p.shipped).length
	return {
		progress,
		qualified: shippedCount >= THEMES_REQUIRED_FOR_PRINTER,
		required: THEMES_REQUIRED_FOR_PRINTER,
		shippedCount,
	}
}

/**
 * Create the award row the first time someone qualifies. Idempotent, and safe to call inside the review transaction.
 */
export async function ensurePrinterAward(tx: Prisma.TransactionClient, userId: string): Promise<PrinterAward | null> {
	const projects = await tx.themeProject.findMany({
		select: { buildReviewedAt: true, theme: true },
		where: {
			buildStatus: PhaseStatus.approved,
			deletedAt: null,
			designStatus: PhaseStatus.approved,
			userId,
		},
	})
	if (projects.length < THEMES_REQUIRED_FOR_PRINTER) return null

	const existing = await tx.printerAward.findUnique({ where: { userId } })
	if (existing) return existing

	return tx.printerAward.create({
		data: {
			qualifiedAt: new Date(),
			// Snapshot the evidence so a later un-approval doesn't erase why this award exists.
			qualifyingSnapshot: projects.map(p => ({
				buildReviewedAt: p.buildReviewedAt?.toISOString() ?? null,
				theme: p.theme,
			})),
			userId,
		},
	})
}

/**
 * Awards whose holder no longer qualifies. Reports only – never auto-revokes, because the printer may already have shipped.
 */
export async function findPrinterAwardMismatches(): Promise<{ userId: string; email: string; shippedCount: number }[]> {
	const awards = await prisma.printerAward.findMany({
		select: { user: { select: { email: true } }, userId: true },
		where: { revokedAt: null },
	})
	const mismatches: { userId: string; email: string; shippedCount: number }[] = []
	for (const award of awards) {
		const q = await getPrinterQualification(award.userId)
		if (!q.qualified)
			mismatches.push({
				email: award.user.email,
				shippedCount: q.shippedCount,
				userId: award.userId,
			})
	}
	return mismatches
}

export interface PrinterAwardUpdate {
	/** Recorded on the audit row; mandatory for a revoke. */
	note: string
	status: PrinterAwardStatus
	trackingCarrier?: string | null
	trackingNumber?: string | null
}

/**
 * The award as it leaves the server: the fulfilment fields, with the locked address read only to say whether one is on file.
 *
 * The ciphertext is read on the server and never returned: it is what an address is locked from, and the fulfilment sheet needs the flag rather than the address.
 */
const printerAwardResponseSelect = {
	addressLockedAt: true,
	deliveredAt: true,
	encryptedAddress: true,
	id: true,
	qualifiedAt: true,
	revokedAt: true,
	revokedReason: true,
	shippedAt: true,
	status: true,
	trackingCarrier: true,
	trackingNumber: true,
	user: { select: { displayName: true, id: true, name: true } },
} satisfies Prisma.PrinterAwardSelect

type PrinterAwardPayload = Prisma.PrinterAwardGetPayload<{ select: typeof printerAwardResponseSelect }>

/** The award row the API returns: the fulfilment fields, and whether an address is locked on file. */
export interface PrinterAwardResponse extends Omit<PrinterAwardPayload, "encryptedAddress"> {
	addressOnFile: boolean
}

/**
 * Move one award along the fulfilment path: lock the address, then pack, ship and deliver it – or revoke it for the record.
 *
 * Conditional on the status that was read, so two admins saving at once cannot skip a step or overwrite a revoke. Locking the address snapshots the participant's HCA address onto the award, encrypted, so an update there afterwards cannot move a package that is already being packed; a lock with no address to snapshot is refused rather than looking ready while shipping nowhere.
 */
export async function updatePrinterAwardStatus(
	awardId: string,
	input: PrinterAwardUpdate,
	adminId: string | null,
	adminEmail: string | null,
): Promise<PrinterAwardResponse> {
	const award = await prisma.printerAward.findUnique({
		include: {
			user: {
				select: {
					encryptedAddressCity: true,
					encryptedAddressCountry: true,
					encryptedAddressLine2: true,
					encryptedAddressState: true,
					encryptedAddressStreet: true,
					encryptedAddressZip: true,
					encryptedPhone: true,
				},
			},
		},
		where: { id: awardId },
	})
	if (!award) throw new HttpError("NOT_FOUND", "Printer award not found")

	if (!canMovePrinterAward(award.status, input.status))
		throw new HttpError(
			"CONFLICT",
			`A ${PRINTER_AWARD_LABELS[award.status]} award cannot move to ${PRINTER_AWARD_LABELS[input.status]}`,
		)

	if (input.status === "REVOKED" && !input.note.trim())
		throw new HttpError("VALIDATION_FAILED", "Say why the award is being revoked")

	const trackingNumber = input.trackingNumber?.trim() || null
	const trackingCarrier = input.trackingCarrier?.trim() || null

	const data: Prisma.PrinterAwardUpdateManyMutationInput = { status: input.status }
	if (input.trackingNumber !== undefined) data.trackingNumber = trackingNumber
	if (input.trackingCarrier !== undefined) data.trackingCarrier = trackingCarrier
	if (input.status === "SHIPPED") data.shippedAt = new Date()
	if (input.status === "DELIVERED") data.deliveredAt = new Date()
	if (input.status === "REVOKED") {
		data.revokedAt = new Date()
		data.revokedReason = input.note.trim()
	}

	if (input.status === "ADDRESS_LOCKED") {
		const pii = isPiiConfigured() ? decryptUserPII(award.user) : null
		const street = [pii?.line1, pii?.line2].filter((part): part is string => Boolean(part?.trim())).join("\n")
		const cityLine = [
			[pii?.city, pii?.state].filter((part): part is string => Boolean(part?.trim())).join(", "),
			pii?.zip,
		]
			.filter((part): part is string => Boolean(part?.trim()))
			.join(" ")
		const address = [street, cityLine, pii?.country?.trim()]
			.filter((part): part is string => Boolean(part?.trim()))
			.join("\n")
			.trim()
		if (!address)
			throw new HttpError(
				"VALIDATION_FAILED",
				"No shipping address is on file for this participant – pull it from HCA (PULL_HCA_PII) or ask them for it before locking.",
			)

		data.encryptedAddress = encryptPII(address)
		if (pii?.phone?.trim()) data.encryptedPhone = encryptPII(pii.phone.trim())
		data.addressLockedAt = new Date()
	}

	const moved = await prisma.printerAward.updateMany({
		data,
		where: { id: awardId, revokedAt: null, status: award.status },
	})
	if (moved.count !== 1)
		throw new HttpError("CONFLICT", "The award moved while this was being saved – reload and try again")

	await logAudit({
		action: input.status === "REVOKED" ? AuditAction.PRINTER_REVOKED : AuditAction.PRINTER_STATUS_CHANGE,
		actorEmail: adminEmail,
		actorId: adminId,
		metadata: {
			after: input.status,
			before: award.status,
			note: input.note.trim() || null,
			userId: award.userId,
			...(input.trackingNumber !== undefined ? { trackingNumber } : {}),
		},
		targetId: awardId,
		targetType: "PrinterAward",
	})

	// The row that goes back to the caller carries the fulfilment fields only: the locked address and the phone are ciphertext and stay on the server.
	const { encryptedAddress, ...updated } = await prisma.printerAward.findUniqueOrThrow({
		select: printerAwardResponseSelect,
		where: { id: awardId },
	})
	return Object.assign(updated, { addressOnFile: encryptedAddress !== "" })
}
