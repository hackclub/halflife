import "server-only"
import { AuditAction, logAudit } from "@/lib/audit"
import type { Phase } from "@/lib/enums"
import { syncHcaProfile } from "@/lib/hca-profile"
import { type DecryptedAddress, decryptUserPII } from "@/lib/pii"
import db from "@/lib/prisma8"

/**
 * Why a maker's address is not on file, when it is not.
 *
 * `no_hca_account` is a maker who has never signed in with Hack Club Auth (a staff import), so no address can ever arrive; it is expected, not a fault. `no_address_on_file` is a linked maker whose HCA holds no mailing address. `address_unreadable` is a stored address that will not decrypt, which points at the encryption key rather than at the maker.
 */
export type AddressGap = "no_hca_account" | "no_address_on_file" | "address_unreadable"

export interface AddressSnapshot {
	gap: AddressGap | null
	pii: DecryptedAddress
	user: NonNullable<Awaited<ReturnType<typeof readUserRow>>>
}

function readUserRow(userId: string) {
	return db.orm.public.User.whereUnique({ id: userId }).firstOrThrow()
}

/**
 * The maker's address as an Airtable row should carry it: HCA asked now, then the stored copy read back.
 *
 * Asking HCA is what keeps the address current, so a decision made after the maker added one ships it. A maker with no HCA account is not asked, and the stored copy is read as before. Never throws: a failed HCA call falls back to the stored copy, which is what the row was written from before.
 *
 * `sync: false` serves the stored copy without asking HCA. The reminder poll uses it between throttled syncs: a page
 * that asks on every mount would otherwise make two HCA requests per view and can get the server's IP throttled,
 * which breaks sign-in and identity checks for everyone.
 */
export async function readAddressSnapshot(
	userId: string,
	{ sync = true }: { sync?: boolean } = {},
): Promise<AddressSnapshot> {
	const linked = await db.orm.public.Account.where({ providerId: "hca", userId }).select("id").first()
	if (linked && sync) await syncHcaProfile(userId)
	const user = await readUserRow(userId)
	const pii = decryptUserPII(user)
	if (pii.line1) return { gap: null, pii, user }
	if (user.encryptedAddressStreet) return { gap: "address_unreadable", pii, user }
	return { gap: linked ? "no_address_on_file" : "no_hca_account", pii, user }
}

/**
 * Leave a trace when a row goes out without an address the maker should have had.
 *
 * A maker with no HCA account is expected to be blank, so it is not recorded. Everything else is: a linked maker with no address on file, or a stored address that will not decrypt. The audit log is where an operator sees these without reading the base or the logs.
 */
export async function noteAddressGap(gap: AddressGap | null, themeProjectId: string, phase: Phase): Promise<void> {
	if (gap === null || gap === "no_hca_account") return
	await logAudit({
		action: AuditAction.AIRTABLE_ADDRESS_GAP,
		metadata: { gap, phase },
		targetId: themeProjectId,
		targetType: "ThemeProject",
	})
}
