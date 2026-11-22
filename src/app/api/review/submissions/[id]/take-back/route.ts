import { after } from "next/server"
import { mirrorReviewDecision, reviewStatusFor } from "@/lib/airtable/sync"
import { ok } from "@/lib/api"
import { PhaseStatus } from "@/lib/enums"
import { type AuthedContext, withWritePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { takeBackDecision } from "@/lib/review"

interface Params {
	params: Promise<{ id: string }>
}

/** A reviewer taking back their own decision: the ship goes back into review, claimed by them (see `takeBackDecision`). */
export const POST = withWritePermission(
	Permission.REVIEW_SUBMISSIONS,
	async (_req: Request, { params, gate }: Params & AuthedContext) => {
		const { id } = await params
		const { feedback, phase, themeProjectId } = await takeBackDecision(id, gate.user)

		// The row follows the phase back to review, and the note goes with the decision it belonged to, as Ari's requeue does.
		after(() =>
			mirrorReviewDecision(themeProjectId, phase, reviewStatusFor(PhaseStatus.in_review), null, null, null, null),
		)

		return ok({ feedback })
	},
)
