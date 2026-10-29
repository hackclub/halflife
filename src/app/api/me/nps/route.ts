import { readNpsStatus, writeNps } from "@/lib/airtable/nps"
import { fail, ok, parseBody } from "@/lib/api"
import { withSession, withWriteSession } from "@/lib/guards"
import { npsSubmitSchema } from "@/lib/schemas/nps"

export const dynamic = "force-dynamic"

/**
 * Whether the dashboard's blocking NPS prompt has been answered.
 *
 * Answered means the Signups row holds a score number – 0 counts, so the check is on type, not truthiness. Unconfigured Airtable or a base without the columns answers "done" rather than blocking: a form that cannot save must never park the user.
 */
export const GET = withSession(async (_req: Request, { gate }) => {
	const status = await readNpsStatus(gate.user.id)
	if ("skipped" in status) return ok({ completed: true, skipped: status.skipped })
	return ok(status)
})

/** Save the NPS answers onto the caller's Signups row. The score is required; the three text answers may be empty. */
export const POST = withWriteSession(async (req: Request, { gate }) => {
	const parsed = await parseBody(req, npsSubmitSchema)
	if (parsed.error) return parsed.error
	const result = await writeNps(gate.user.id, parsed.data)
	if ("skipped" in result)
		return fail("UNAVAILABLE", "Your feedback couldn't be saved right now. Try again in a moment.")
	return ok({ saved: true })
})
