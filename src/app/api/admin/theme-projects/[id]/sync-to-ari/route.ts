import { z } from "zod"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { isAriConfigured, sendSubmissionToAri } from "@/lib/ari"
import { HttpError } from "@/lib/errors"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { phaseSchema } from "@/lib/schemas/common"
import { trackSideEffect } from "@/lib/side-effects"

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 60

const bodySchema = z.object({ phase: phaseSchema }).strict()

/**
 * Re-send a hand-in that never reached Ari — a send that failed, or one made
 * before the ARI_* secrets were set. Same work the hourly retry job does, for
 * the one submission an admin is looking at.
 *
 * Sending writes an ARI_SYNC_SUCCESS/FAILURE audit row through trackSideEffect,
 * so a replay is as visible as the original attempt.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_PROGRAM)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, bodySchema)
  if (parsed.error) return parsed.error

  if (!isAriConfigured()) {
    return fail("NOT_CONFIGURED", "Ari is not configured on this deployment")
  }

  // A ship is a hand-in, so only a phase awaiting review has one to send: a
  // draft was never submitted, and a decided phase is already Ari's record.
  const project = await prisma.themeProject.findUnique({
    where: { id },
    select: { designStatus: true, buildStatus: true },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")
  const status = parsed.data.phase === "DESIGN" ? project.designStatus : project.buildStatus
  if (status !== PhaseStatus.in_review) {
    return fail("CONFLICT", "That phase is not awaiting review, so there is no ship to send")
  }

  try {
    const result = await trackSideEffect(
      "ari",
      {
        actorId: gate.user.id,
        actorEmail: gate.user.email,
        targetType: "ThemeProject",
        targetId: id,
        metadata: { phase: parsed.data.phase, manual: true },
      },
      () => sendSubmissionToAri(id, parsed.data.phase),
      // The audit row is written either way; rethrowing lets a refusal that
      // names a missing field reach the admin instead of a generic failure.
      { rethrow: true },
    )
    return ok({ result })
  } catch (err) {
    if (err instanceof HttpError) return fail(err.code, err.message)
    return fail("UNAVAILABLE", "Ari did not accept the ship; the audit log has the error")
  }
})
