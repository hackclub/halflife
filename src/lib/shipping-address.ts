import "server-only"
import { readAddressSnapshot } from "@/lib/airtable/address"
import { PhaseStatus } from "@/lib/enums"
import { PULL_PII } from "@/lib/hca-profile"
import db from "@/lib/prisma8"

/**
 * How often the reminder may ask HCA again for one person.
 *
 * Each sync costs two HCA requests (with retries), may refresh a token, and rewrites the user's encrypted address.
 * The shell mounts the reminder on every page, so without a floor one open tab is a steady stream of calls – and HCA
 * already answers this server with 429s, so throttling its IP would break sign-in for everyone. Ten minutes is short
 * enough that an address added during a sitting is noticed, long enough that no page view repeats the work.
 */
export const ADDRESS_RESYNC_MS = 10 * 60_000

/** Last sync per person, for this process. A restart just means the next view asks again. */
const lastSyncAt = new Map<string, number>()

/**
 * Whether the caller has approved work and no address to ship it to.
 *
 * This is the one case the reminder is for: a design has been approved – which is the decision that funds parts – and Hack Club Auth holds no mailing address for the maker. The address is read through the same snapshot the Airtable row is written from (lib/airtable/address), so it asks HCA again and stores what it finds: someone who added an address since their last sign-in stops being reminded.
 *
 * The HCA call is throttled per person; between syncs the stored copy is what the answer comes from.
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

	const now = Date.now()
	const last = lastSyncAt.get(userId) ?? 0
	const due = now - last >= ADDRESS_RESYNC_MS
	if (due) {
		// Bounded rather than unbounded: only approved makers reach this, and an old entry is no worse than a miss.
		if (lastSyncAt.size > 10_000) lastSyncAt.clear()
		lastSyncAt.set(userId, now)
	}
	const { gap } = await readAddressSnapshot(userId, { sync: due })
	return gap === "no_address_on_file"
}
