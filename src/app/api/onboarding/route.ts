import { ok, parseBody, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { onboardingStepSchema } from "@/lib/schemas/onboarding"
import { getOnboardingState, submitStep, type OnboardingAnswer } from "@/lib/onboarding"
import { toOnboardingView } from "@/lib/onboarding-view"
import { AuditAction, logAudit } from "@/lib/audit"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  return ok({ onboarding: toOnboardingView(await getOnboardingState(gate.user.id)) })
})

export const POST = withRoute(async (req: Request) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const parsed = await parseBody(req, onboardingStepSchema)
  if (parsed.error) return parsed.error

  // The schema's variants line up with OnboardingAnswer one for one; the cast
  // is only because Zod infers the literal union separately from the type the
  // state machine declares.
  const result = await submitStep(gate.user.id, parsed.data as OnboardingAnswer)

  await logAudit({
    action: result.completed ? AuditAction.USER_COMPLETE_ONBOARDING : AuditAction.USER_ADVANCE_ONBOARDING,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "User",
    targetId: gate.user.id,
    metadata: { step: parsed.data.step, reached: result.state.reached },
  })

  return ok({ onboarding: toOnboardingView(result.state) })
})
