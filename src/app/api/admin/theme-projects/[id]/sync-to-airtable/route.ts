import { z } from "zod"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import prisma from "@/lib/prisma"
import { PhaseStatus } from "@/app/generated/prisma/enums"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { phaseSchema } from "@/lib/schemas/common"
import { syncSubmissionToYsws } from "@/lib/airtable/sync"
import { trackSideEffect } from "@/lib/side-effects"

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 60

const bodySchema = z.object({ phase: phaseSchema }).strict()

/**
 * Replay a submission-row write that failed the first time, or refresh a row
 * with the project as it stands now. Writes to the same row as before.
 *
 * The audit log is where a failed sync shows up; this is how an admin fixes it.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
  const gate = await requirePermission(Permission.MANAGE_PROGRAM)
  if (gate.error) return gate.error
  const { id } = await params

  const parsed = await parseBody(req, bodySchema)
  if (parsed.error) return parsed.error

  // A row is a submission, so only a phase that has been handed in gets one —
  // never a draft, which is how an empty 0-hour row would otherwise appear.
  const project = await prisma.themeProject.findUnique({
    where: { id },
    select: { designStatus: true, buildStatus: true },
  })
  if (!project) return fail("NOT_FOUND", "Project not found")
  const status = parsed.data.phase === "DESIGN" ? project.designStatus : project.buildStatus
  if (status === PhaseStatus.draft) {
    return fail("VALIDATION_FAILED", "That phase has not been submitted, so it has no Airtable row")
  }

  const result = await trackSideEffect(
    "airtable",
    {
      actorId: gate.user.id,
      actorEmail: gate.user.email,
      targetType: "ThemeProject",
      targetId: id,
      metadata: { phase: parsed.data.phase, manual: true },
    },
    () => syncSubmissionToYsws(id, parsed.data.phase),
  )

  return ok({ result })
})
