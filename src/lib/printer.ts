import "server-only"
import { PhaseStatus, type PrinterAwardStatus, type Theme } from "@/app/generated/prisma/enums"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { AuditAction, logAudit } from "@/lib/audit"
import { THEMES, THEMES_REQUIRED_FOR_PRINTER } from "@/lib/config/program"
import { HttpError } from "@/lib/errors"
import { decryptUserPII, encryptPII, isPiiConfigured } from "@/lib/pii"
import { canMovePrinterAward, PRINTER_AWARD_LABELS } from "@/lib/printer-award"
import db, { type DbOrTx } from "@/lib/prisma8"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

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
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null, userId })
		.select("buildReviewedAt", "buildStatus", "designStatus", "theme")
		.all()
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
export async function ensurePrinterAward(
	tx: DbOrTx,
	userId: string,
): Promise<Omit<Models.public_PrinterAward, "user"> | null> {
	const projects = await tx.orm.public.ThemeProject.where({
		buildStatus: PhaseStatus.approved,
		deletedAt: null,
		designStatus: PhaseStatus.approved,
		userId,
	})
		.select("buildReviewedAt", "theme")
		.all()
	if (projects.length < THEMES_REQUIRED_FOR_PRINTER) return null

	const existing = await tx.orm.public.PrinterAward.where({ userId }).first()
	if (existing) return existing

	return tx.orm.public.PrinterAward.create({
		qualifiedAt: formatDbTimestamp(new Date()),
		// Snapshot the evidence so a later un-approval doesn't erase why this award exists.
		qualifyingSnapshot: projects.map(p => ({
			buildReviewedAt: p.buildReviewedAt,
			theme: p.theme,
		})),
		userId,
	})
}

/**
 * Awards whose holder no longer qualifies. Reports only – never auto-revokes, because the printer may already have shipped.
 */
export async function findPrinterAwardMismatches(): Promise<{ userId: string; email: string; shippedCount: number }[]> {
	const awards = await db.orm.public.PrinterAward.where(award => award.revokedAt.isNull())
		.select("id", "userId")
		.include("user", user => user.select("email"))
		.all()
	const mismatches: { userId: string; email: string; shippedCount: number }[] = []
	for (const award of awards) {
		if (!award.user) throw new Error(`printer award ${award.id} has no holder`)
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
/** The award row the API returns: the fulfilment fields, and whether an address is locked on file. Timestamps are Dates, parsed from the PostgreSQL text Prisma 8 returns. */
export interface PrinterAwardResponse {
	addressLockedAt: Date | null
	addressOnFile: boolean
	deliveredAt: Date | null
	id: string
	qualifiedAt: Date
	revokedAt: Date | null
	revokedReason: string | null
	shippedAt: Date | null
	status: Models.public_PrinterAward["status"]
	trackingCarrier: string | null
	trackingNumber: string | null
	user: { displayName: string | null; id: string; name: string | null }
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
	const award = await db.orm.public.PrinterAward.whereUnique({ id: awardId })
		.include("user", user =>
			user.select(
				"encryptedAddressCity",
				"encryptedAddressCountry",
				"encryptedAddressLine2",
				"encryptedAddressState",
				"encryptedAddressStreet",
				"encryptedAddressZip",
				"encryptedPhone",
			),
		)
		.first()
	if (!award?.user) throw new HttpError("NOT_FOUND", "Printer award not found")

	if (!canMovePrinterAward(award.status, input.status))
		throw new HttpError(
			"CONFLICT",
			`A ${PRINTER_AWARD_LABELS[award.status]} award cannot move to ${PRINTER_AWARD_LABELS[input.status]}`,
		)

	if (input.status === "REVOKED" && !input.note.trim())
		throw new HttpError("VALIDATION_FAILED", "Say why the award is being revoked")

	const trackingNumber = input.trackingNumber?.trim() || null
	const trackingCarrier = input.trackingCarrier?.trim() || null

	const data: {
		status: Models.public_PrinterAward["status"]
		trackingNumber?: string | null
		trackingCarrier?: string | null
		shippedAt?: string
		deliveredAt?: string
		revokedAt?: string
		revokedReason?: string
		encryptedAddress?: string
		encryptedPhone?: string
		addressLockedAt?: string
	} = { status: input.status }
	if (input.trackingNumber !== undefined) data.trackingNumber = trackingNumber
	if (input.trackingCarrier !== undefined) data.trackingCarrier = trackingCarrier
	if (input.status === "SHIPPED") data.shippedAt = formatDbTimestamp(new Date())
	if (input.status === "DELIVERED") data.deliveredAt = formatDbTimestamp(new Date())
	if (input.status === "REVOKED") {
		data.revokedAt = formatDbTimestamp(new Date())
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
		data.addressLockedAt = formatDbTimestamp(new Date())
	}

	const moved = await db.orm.public.PrinterAward.where({ id: awardId })
		.where(aw => aw.revokedAt.isNull())
		.where({ status: award.status })
		.updateAndCount(data)
	if (moved !== 1) throw new HttpError("CONFLICT", "The award moved while this was being saved – reload and try again")

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
	const updated = await db.orm.public.PrinterAward.whereUnique({ id: awardId })
		.select(
			"addressLockedAt",
			"deliveredAt",
			"encryptedAddress",
			"id",
			"qualifiedAt",
			"revokedAt",
			"revokedReason",
			"shippedAt",
			"status",
			"trackingCarrier",
			"trackingNumber",
		)
		.include("user", user => user.select("displayName", "id", "name"))
		.firstOrThrow()
	if (!updated.user) throw new HttpError("NOT_FOUND", "Printer award not found")
	const { encryptedAddress, user, ...rest } = updated
	const parseNullable = (value: string | null): Date | null => (value === null ? null : parseDbTimestamp(value))
	return Object.assign(rest, {
		addressLockedAt: parseNullable(rest.addressLockedAt),
		addressOnFile: encryptedAddress !== "",
		deliveredAt: parseNullable(rest.deliveredAt),
		qualifiedAt: parseDbTimestamp(rest.qualifiedAt),
		revokedAt: parseNullable(rest.revokedAt),
		shippedAt: parseNullable(rest.shippedAt),
		user,
	})
}
