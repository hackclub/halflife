import { ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { addressReminderNeeded } from "@/lib/shipping-address"

export const dynamic = "force-dynamic"

/**
 * Whether to show the shipping-address reminder: approved parts and no address in Hack Club Auth.
 *
 * Cheap for everyone without an approved design, since the project check comes first and only then is the address
 * read. The HCA sync itself is throttled per person in `addressReminderNeeded`, so a shell that mounts this on every
 * page view cannot turn into a steady stream of identity-provider calls.
 */
export const GET = withSession(async (_req: Request, { gate }) =>
	ok({ needed: await addressReminderNeeded(gate.user.id) }),
)
