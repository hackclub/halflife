/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import { fail, ok } from "@/lib/api"
import { type AuthedContext, withSession } from "@/lib/guards"
import { claimHandoff, getHandoffStatus } from "@/lib/handoff"

interface Params {
	params: Promise<{ id: string }>
}

/** Polled by the desktop while it waits for the phone. */
export const GET = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const status = await getHandoffStatus(id, gate.user.id)
	if (!status) return fail("NOT_FOUND", "No such handoff")

	return ok(status)
})

/** Called once the desktop has taken the object key, to stop the polling. */
export const POST = withSession(async (_req: Request, { params, gate }: Params & AuthedContext) => {
	const { id } = await params

	const claimed = await claimHandoff(id, gate.user.id)
	if (!claimed) return fail("NOT_FOUND", "No such handoff")
	return ok({ claimed: true })
})

export const dynamic = "force-dynamic"
