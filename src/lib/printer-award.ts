import type { PrinterAwardStatus } from "@/app/generated/prisma/enums"

/**
 * How a printer award moves from "earned" to "in someone's hands".
 *
 * Pure so the admin form and the server validate the same path, and so `verify:contracts` can pin it without a database. A revoke is legal from anywhere except the two terminal states: a shipped printer cannot be un-shipped, but the award can still be marked revoked for the record (the qualification mismatch report treats that as a report, never a recall).
 */
export const PRINTER_AWARD_LABELS: Record<PrinterAwardStatus, string> = {
	ADDRESS_LOCKED: "address locked",
	DELIVERED: "delivered",
	PACKING: "packing",
	QUALIFIED: "qualified",
	REVOKED: "revoked",
	SHIPPED: "shipped",
}

/** The moves an award may make, in display order. Empty means final. */
export const PRINTER_AWARD_NEXT: Record<PrinterAwardStatus, readonly PrinterAwardStatus[]> = {
	ADDRESS_LOCKED: ["PACKING", "REVOKED"],
	DELIVERED: [],
	PACKING: ["SHIPPED", "REVOKED"],
	QUALIFIED: ["ADDRESS_LOCKED", "REVOKED"],
	REVOKED: [],
	SHIPPED: ["DELIVERED", "REVOKED"],
}

export function canMovePrinterAward(from: PrinterAwardStatus, to: PrinterAwardStatus): boolean {
	return (PRINTER_AWARD_NEXT[from] as readonly PrinterAwardStatus[]).includes(to)
}
