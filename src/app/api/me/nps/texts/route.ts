import { writeNpsTexts } from "@/lib/airtable/nps"
import { fail, ok, parseBody } from "@/lib/api"
import { withWriteSession } from "@/lib/guards"
import { npsTextsSubmitSchema } from "@/lib/schemas/nps"

export const dynamic = "force-dynamic"

/** Save the NPS follow-up texts – the unblocking second step, sent from the corner nudge. All three answers may be empty. */
export const POST = withWriteSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, npsTextsSubmitSchema)
	if (parsed.error) return parsed.error
	const result = await writeNpsTexts(gate.user.id, parsed.data)
	if ("skipped" in result)
		return fail("UNAVAILABLE", "Your feedback couldn't be saved right now. Try again in a moment.")
	return ok({ saved: true })
})
