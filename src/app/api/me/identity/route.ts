import { ok } from "@/lib/api"
import { withSession } from "@/lib/guards"
import { identityReminderNeeded } from "@/lib/identity-reminder-needed"

export const dynamic = "force-dynamic"

/**
 * Whether to show the identity reminder: approved work and no identity check cleared yet.
 *
 * Cheap for everyone without an approved design, since that check comes first. The HCA call behind the answer is throttled per person in `identityReminderNeeded`.
 */
export const GET = withSession(async (_req: Request, { gate }) =>
	ok({ needed: await identityReminderNeeded(gate.user.id) }),
)
