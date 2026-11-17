import "server-only"
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
 */
export async function readAddressSnapshot(userId: string): Promise<AddressSnapshot> {
	const linked = await db.orm.public.Account.where({ providerId: "hca", userId }).select("id").first()
	if (linked) await syncHcaProfile(userId)
	const user = await readUserRow(userId)
	const pii = decryptUserPII(user)
	if (pii.line1) return { gap: null, pii, user }
	if (user.encryptedAddressStreet) return { gap: "address_unreadable", pii, user }
	return { gap: linked ? "no_address_on_file" : "no_hca_account", pii, user }
}
