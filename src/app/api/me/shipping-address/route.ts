import { ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { addressReminderNeeded } from "@/lib/shipping-address"

export const dynamic = "force-dynamic"

/**
 * Whether to show the shipping-address reminder: approved parts and no address in Hack Club Auth.
 *
 * Read-only and cheap for everyone without an approved design, since the project check comes first and only then does it ask HCA. The answer is not cached, because the point of asking is to notice an address the maker just added.
 */
export const GET = withSession(async (_req: Request, { gate }) =>
	ok({ needed: await addressReminderNeeded(gate.user.id) }),
)
