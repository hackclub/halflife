import { readNpsState, writeNpsScore } from "@/lib/airtable/nps"
import { fail, ok, parseBody } from "@/lib/api"
import { withSession, withWriteSession } from "@/lib/guards"
import { npsSubmitSchema } from "@/lib/schemas/nps"

export const dynamic = "force-dynamic"

/**
 * Where the caller stands in the two-step NPS flow: the score gates the dashboard, and the texts decide the corner nudge. Unconfigured Airtable or a base without the columns answers "nothing to ask" rather than blocking: a form that cannot save must never park the user.
 */
export const GET = withSession(async (_req: Request, { gate }) => {
	const state = await readNpsState(gate.user.id)
	if ("skipped" in state) return ok({ score: null, skipped: state.skipped, textsDone: true })
	return ok(state)
})

/** Save the NPS score – the blocking first step. The text answers may ride along, but the corner nudge asks for them again. */
export const POST = withWriteSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, npsSubmitSchema)
	if (parsed.error) return parsed.error
	const result = await writeNpsScore(gate.user.id, parsed.data.howLikelyRecommend)
	if ("skipped" in result) return fail("UNAVAILABLE", "Your score couldn't be saved right now. Try again in a moment.")
	return ok({ saved: true })
})
