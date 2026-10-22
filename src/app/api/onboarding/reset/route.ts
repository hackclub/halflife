import { after } from "next/server"
import { Role } from "@/app/generated/prisma/enums"
import { ok } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withRole } from "@/lib/guards"
import { getOnboardingState, resetOnboarding } from "@/lib/onboarding"
import { toOnboardingView } from "@/lib/onboarding-view"

export const dynamic = "force-dynamic"

/**
 * An admin walking the first checkpoint again as a participant would.
 *
 * Their own onboarding only, never someone else's: this is for checking the flow, and there is no id to pass. Admin-only because the setup answers are otherwise taken once, and a participant resetting theirs could re-roll a starter project's tier lock.
 */
export const POST = withRole(Role.ADMIN, async (_req: Request, { gate }) => {
	await resetOnboarding(gate.user.id)

	after(() =>
		logAudit({
			action: AuditAction.ADMIN_RESET_ONBOARDING,
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			targetId: gate.user.id,
			targetType: "User",
		}),
	)

	return ok({ onboarding: toOnboardingView(await getOnboardingState(gate.user.id)) })
})
