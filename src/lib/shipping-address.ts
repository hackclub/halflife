import "server-only"
import { readAddressSnapshot } from "@/lib/airtable/address"
import { PhaseStatus } from "@/lib/enums"
import { PULL_PII } from "@/lib/hca-profile"
import db from "@/lib/prisma8"

/**
 * Whether the caller has approved work and no address to ship it to.
 *
 * This is the one case the reminder is for: a design has been approved – which is the decision that funds parts – and Hack Club Auth holds no mailing address for the maker. The address is read through the same snapshot the Airtable row is written from (lib/airtable/address), so it asks HCA again and stores what it finds: someone who added an address since their last sign-in stops being reminded the first time this runs.
 *
 * Anything else answers false rather than guessing:
 *
 * - No approved design means there is nothing to post yet, so a missing address is not a problem.
 * - `address_unreadable` is a broken PII key rather than a missing address; asking the maker to type it again would not fix it.
 * - `no_hca_account` is a staff-imported maker with no account to add one to.
 * - With PULL_HCA_PII off, addresses are never stored, so "no address on file" would describe the deployment rather than the person and warn every approved maker.
 */
export async function addressReminderNeeded(userId: string): Promise<boolean> {
	if (!PULL_PII) return false
	const approved = await db.orm.public.ThemeProject.where({
		deletedAt: null,
		designStatus: PhaseStatus.approved,
		userId,
	})
		.select("id")
		.first()
	if (!approved) return false
	const { gap } = await readAddressSnapshot(userId)
	return gap === "no_address_on_file"
}
