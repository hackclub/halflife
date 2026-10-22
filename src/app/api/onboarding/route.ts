import { after } from "next/server"
import { markProjectCreated } from "@/lib/analytics"
import { ok, parseBody } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { withSession } from "@/lib/guards"
import { getOnboardingState, submitStep } from "@/lib/onboarding"
import { toOnboardingView } from "@/lib/onboarding-view"
import { assertWeekStarted } from "@/lib/program"
import { enableRepoSync } from "@/lib/repo-sync"
import { onboardingStepSchema } from "@/lib/schemas/onboarding"

export const dynamic = "force-dynamic"

export const GET = withSession(async (_req: Request, { gate }) =>
	ok({ onboarding: toOnboardingView(await getOnboardingState(gate.user.id)) }),
)

export const POST = withSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, onboardingStepSchema)
	if (parsed.error) return parsed.error

	// Get started is week 1's first checkpoint, so it waits for week 1 too. The intro and the tab tour do not: they are the browser's, and play for a new account whatever the date.
	await assertWeekStarted(1)

	const result = await submitStep(gate.user.id, parsed.data)

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
			actorEmail: gate.user.email,
			actorId: gate.user.id,
			metadata: { reached: result.state.reached, step: parsed.data.step },
			targetId: gate.user.id,
			targetType: "User",
		}),
	)

	return ok({ onboarding: toOnboardingView(result.state) })
})
