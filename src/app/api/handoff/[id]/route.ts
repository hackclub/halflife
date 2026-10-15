import { fail, ok, withRoute } from "@/lib/api"
import { requireSession } from "@/lib/guards"
import { claimHandoff, getHandoffStatus } from "@/lib/handoff"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Polled by the desktop while it waits for the phone. */
export const GET = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const status = await getHandoffStatus(id, gate.user.id)
	if (!status) return fail("NOT_FOUND", "No such handoff")

	return ok(status)
})

/** Called once the desktop has taken the object key, to stop the polling. */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requireSession()
	if (gate.error) return gate.error
	const { id } = await params

	const claimed = await claimHandoff(id, gate.user.id)
	if (!claimed) return fail("NOT_FOUND", "No such handoff")
	return ok({ claimed: true })
})
