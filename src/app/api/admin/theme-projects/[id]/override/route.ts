import { z } from "zod"
import { ok, parseBody, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { reopenPhase, unapprovePhase } from "@/lib/review"
import { sanitize } from "@/lib/sanitize"
import { overrideSchema } from "@/lib/schemas/review"

type Params = { params: Promise<{ id: string }> }

const bodySchema = overrideSchema.extend({
  action: z.enum(["unapprove", "reopen"]),
})

/**
 * Reversing a decision.
 *
 * Un-approving reconciles the project's credit to zero rather than writing a
 * compensating "reversal" kind, so the balance lands exactly where it started
 * and re-approving later cannot double-pay.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.OVERRIDE_DECISIONS)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, bodySchema)
  if (parsed.error) return parsed.error
  const { action, phase, reason } = parsed.data

  if (action === "unapprove") {
    await unapprovePhase(id, phase, gate.user.id, gate.user.email, sanitize(reason))
  } else {
    await reopenPhase(id, phase, gate.user.id, gate.user.email, sanitize(reason))
  }

  return ok({ ok: true })
})
