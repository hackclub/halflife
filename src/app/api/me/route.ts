import { z } from "zod"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { PRINTERS } from "@/lib/config/printers"
import { getBalances, getEarnedCredit } from "@/lib/currency"
import { requireSession } from "@/lib/guards"
import { permissionsFor } from "@/lib/permissions"
import { getPrinterQualification } from "@/lib/printer"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

const updateMeSchema = z.object({ printerGoalId: z.string().max(80) }).strict()

export const GET = withRoute(async () => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const [user, balances, earned, printer] = await Promise.all([
    prisma.user.findUnique({
      where: { id: gate.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        image: true,
        slackId: true,
        verificationStatus: true,
        hackatimeUserId: true,
        fraudFlagged: true,
        submissionExtensionUntil: true,
      },
    }),
    prisma.$transaction((tx) => getBalances(tx, gate.user.id)),
    prisma.$transaction((tx) => getEarnedCredit(tx, gate.user.id)),
    getPrinterQualification(gate.user.id),
  ])

  return ok({
    user: { ...user, hackatimeLinked: !!user?.hackatimeUserId },
    roles: gate.roles,
    permissions: permissionsFor(gate.roles),
    credit: { ...balances, earned },
    printer,
  })
})

/**
 * The only thing a participant may change about themselves here: the printer
 * they are saving for.
 *
 * It is economically load-bearing — it sets how many hours of every approved
 * design week mint into the printer fund — so it is validated against the
 * catalogue rather than stored as whatever string arrived. Changing it does not
 * rewrite anything already banked: past approvals froze the goal they were paid
 * against, and the ledger is append-only.
 */
export const PATCH = withRoute(async (req: Request) => {
  const gate = await requireSession()
  if (gate.error) return gate.error

  const parsed = await parseBody(req, updateMeSchema)
  if (parsed.error) return parsed.error

  const goal = PRINTERS.find((p) => p.id === parsed.data.printerGoalId)
  if (!goal) return fail("VALIDATION_FAILED", "Unknown printer")

  await prisma.user.update({
    where: { id: gate.user.id },
    data: { printerGoalId: goal.id },
  })

  await logAudit({
    action: AuditAction.USER_SET_PRINTER_GOAL,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "User",
    targetId: gate.user.id,
    metadata: { printerGoalId: goal.id },
  })

  return ok({ printerGoalId: goal.id })
})
