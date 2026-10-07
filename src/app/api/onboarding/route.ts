import { after } from "next/server"
import { markProjectCreated } from "@/lib/analytics"
import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requireSession } from "@/lib/guards"
import { getOnboardingState, type OnboardingAnswer, submitStep } from "@/lib/onboarding"
import { toOnboardingView } from "@/lib/onboarding-view"
import { assertWeekStarted } from "@/lib/program"
import { enableRepoSync } from "@/lib/repo-sync"
import { onboardingStepSchema } from "@/lib/schemas/onboarding"

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

	// Get started is week 1's first checkpoint, so it waits for week 1 too. The intro and the tab tour do not: they are the browser's, and play for a new account whatever the date.
	await assertWeekStarted(1)

	// The schema's variants line up with OnboardingAnswer one for one; the cast is only because Zod infers the literal union separately from the type the state machine declares.
	const result = await submitStep(gate.user.id, parsed.data as OnboardingAnswer)

	// The analytics stamp for a named project: after the response, since it is nothing the person is waiting on, and quiet about its own failures.
	if (result.touchedProject) after(() => markProjectCreated(result.state.project.id, gate.user.id))

	// A repo chosen on the last step is written to GitHub after the response. Its failure is recorded on the project (and shown on its page), not thrown back at someone who has just finished setup.
	if (result.repoRequest) {
		// Read the repo out here: the narrowing above does not survive into the deferred closure, so the `!` that used to bridge it is not needed.
		const repo = result.repoRequest.repo
		after(async () => {
			try {
				await enableRepoSync(result.state.project.id, gate.user.id, repo)
			} catch (err) {
				console.error("[onboarding] repo sync setup failed:", err)
			}
		})
	}

	after(() =>
		logAudit({
			action: result.completed ? AuditAction.USER_COMPLETE_ONBOARDING : AuditAction.USER_ADVANCE_ONBOARDING,
			actorId: gate.user.id,
			actorEmail: gate.user.email,
			targetType: "User",
			targetId: gate.user.id,
			metadata: { step: parsed.data.step, reached: result.state.reached },
		}),
	)

	return ok({ onboarding: toOnboardingView(result.state) })
})
