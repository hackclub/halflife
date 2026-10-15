import "server-only"
import type { PrinterAward, Prisma } from "@/app/generated/prisma/client"
import { PhaseStatus, type PrinterAwardStatus, type Theme } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { THEMES, THEMES_REQUIRED_FOR_PRINTER } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { decryptUserPII, encryptPII, isPiiConfigured } from "@/lib/pii"
import { canMovePrinterAward, PRINTER_AWARD_LABELS } from "@/lib/printer-award"
import prisma from "@/lib/prisma"

export type ThemeProgress = {
	theme: Theme
	design: boolean
	build: boolean
	shipped: boolean
}

export type PrinterQualification = {
	qualified: boolean
	shippedCount: number
	required: number
	progress: ThemeProgress[]
}

/**
 * Always derived from ThemeProject state, never read from PrinterAward.
 *
 * Keeping eligibility and fulfilment separate means an un-approval after the award surfaces as a mismatch an admin resolves, rather than silently revoking a printer that is already in a box.
 */
export async function getPrinterQualification(userId: string): Promise<PrinterQualification> {
	const projects = await prisma.themeProject.findMany({
		where: { userId, deletedAt: null },
		select: { theme: true, designStatus: true, buildStatus: true, buildReviewedAt: true },
	})
	const byTheme = new Map(projects.map(p => [p.theme, p]))

	const progress: ThemeProgress[] = THEMES.map(def => {
		const p = byTheme.get(def.id)
		const design = p?.designStatus === PhaseStatus.approved
		const build = p?.buildStatus === PhaseStatus.approved
		return { theme: def.id, design, build, shipped: design && build }
	})

	const shippedCount = progress.filter(p => p.shipped).length
	return {
		qualified: shippedCount >= THEMES_REQUIRED_FOR_PRINTER,
		shippedCount,
		required: THEMES_REQUIRED_FOR_PRINTER,
		progress,
	}
}

/**
 * Create the award row the first time someone qualifies. Idempotent, and safe to call inside the review transaction.
 */
export async function ensurePrinterAward(tx: Prisma.TransactionClient, userId: string): Promise<PrinterAward | null> {
	const projects = await tx.themeProject.findMany({
		where: {
			userId,
			deletedAt: null,
			designStatus: PhaseStatus.approved,
			buildStatus: PhaseStatus.approved,
		},
		select: { theme: true, buildReviewedAt: true },
	})
	if (projects.length < THEMES_REQUIRED_FOR_PRINTER) return null

	const existing = await tx.printerAward.findUnique({ where: { userId } })
	if (existing) return existing

	return tx.printerAward.create({
		data: {
			userId,
			qualifiedAt: new Date(),
			// Snapshot the evidence so a later un-approval doesn't erase why this award exists.
			qualifyingSnapshot: projects.map(p => ({
				theme: p.theme,
				buildReviewedAt: p.buildReviewedAt?.toISOString() ?? null,
			})),
		},
	})
}

/**
 * Awards whose holder no longer qualifies. Reports only – never auto-revokes, because the printer may already have shipped.
 */
export async function findPrinterAwardMismatches(): Promise<{ userId: string; email: string; shippedCount: number }[]> {
	const awards = await prisma.printerAward.findMany({
		where: { revokedAt: null },
		select: { userId: true, user: { select: { email: true } } },
	})
	const mismatches: { userId: string; email: string; shippedCount: number }[] = []
	for (const award of awards) {
		const q = await getPrinterQualification(award.userId)
		if (!q.qualified) {
			mismatches.push({
				userId: award.userId,
				email: award.user.email,
				shippedCount: q.shippedCount,
			})
		}
	}
	return mismatches
}

export type PrinterAwardUpdate = {
	status: PrinterAwardStatus
	trackingNumber?: string | null
	trackingCarrier?: string | null
	/** Recorded on the audit row; mandatory for a revoke. */
	note: string
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
): Promise<PrinterAward> {
	const award = await prisma.printerAward.findUnique({
		where: { id: awardId },
		include: {
			user: {
				select: {
					encryptedAddressStreet: true,
					encryptedAddressLine2: true,
					encryptedAddressCity: true,
					encryptedAddressState: true,
					encryptedAddressZip: true,
					encryptedAddressCountry: true,
					encryptedPhone: true,
				},
			},
		},
	})
	if (!award) throw new HttpError("NOT_FOUND", "Printer award not found")

	if (!canMovePrinterAward(award.status, input.status)) {
		throw new HttpError(
			"CONFLICT",
			`A ${PRINTER_AWARD_LABELS[award.status]} award cannot move to ${PRINTER_AWARD_LABELS[input.status]}`,
		)
	}
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
		const street = [pii?.line1, pii?.line2].filter((part): part is string => !!part?.trim()).join("\n")
		const cityLine = [[pii?.city, pii?.state].filter((part): part is string => !!part?.trim()).join(", "), pii?.zip]
			.filter((part): part is string => !!part?.trim())
			.join(" ")
		const address = [street, cityLine, pii?.country?.trim()]
			.filter((part): part is string => !!part?.trim())
			.join("\n")
			.trim()
		if (!address) {
			throw new HttpError(
				"VALIDATION_FAILED",
				"No shipping address is on file for this participant – pull it from HCA (PULL_HCA_PII) or ask them for it before locking.",
			)
		}
		data.encryptedAddress = encryptPII(address)
		if (pii?.phone?.trim()) data.encryptedPhone = encryptPII(pii.phone.trim())
		data.addressLockedAt = new Date()
	}

	const moved = await prisma.printerAward.updateMany({
		where: { id: awardId, status: award.status, revokedAt: null },
		data,
	})
	if (moved.count !== 1)
		throw new HttpError("CONFLICT", "The award moved while this was being saved – reload and try again")

	await logAudit({
		action: input.status === "REVOKED" ? AuditAction.PRINTER_REVOKED : AuditAction.PRINTER_STATUS_CHANGE,
		actorId: adminId,
		actorEmail: adminEmail,
		targetType: "PrinterAward",
		targetId: awardId,
		metadata: {
			userId: award.userId,
			before: award.status,
			after: input.status,
			note: input.note.trim() || null,
			...(input.trackingNumber !== undefined ? { trackingNumber } : {}),
		},
	})

	return prisma.printerAward.findUniqueOrThrow({ where: { id: awardId } })
}
