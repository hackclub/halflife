import { ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { getProgramSettings } from "@/lib/program"
import { programSettingsSchema } from "@/lib/schemas/admin"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requirePermission(Permission.MANAGE_PROGRAM)
  if (gate.error) return gate.error
  return ok({ settings: await getProgramSettings() })
})

/**
 * The kill switches live here rather than in env vars deliberately. Stasis put
 * its submission gate in SUBMISSIONS_CLOSED and it was never flipped in the
 * dashboard, so submissions silently stayed open for two weeks after the event
 * ended. A row with a toggle and an audit trail cannot be forgotten.
 */
export const PATCH = withRoute(async (req: Request) => {
  const gate = await requirePermission(Permission.MANAGE_PROGRAM)
  if (gate.error) return gate.error

  const parsed = await parseBody(req, programSettingsSchema)
  if (parsed.error) return parsed.error

  const before = await getProgramSettings()
  const settings = await prisma.programSettings.update({
    where: { id: "singleton" },
    data: { ...parsed.data, updatedById: gate.user.id },
  })

  await logAudit({
    action: AuditAction.ADMIN_UPDATE_PROGRAM_SETTINGS,
    actorId: gate.user.id,
    actorEmail: gate.user.email,
    targetType: "ProgramSettings",
    targetId: "singleton",
    metadata: {
      before: {
        submissionsOpen: before.submissionsOpen,
        shopOpen: before.shopOpen,
        eventStartDate: before.eventStartDate.toISOString(),
        airtableSyncEnabled: before.airtableSyncEnabled,
        repoSyncEnabled: before.repoSyncEnabled,
      },
      after: {
        submissionsOpen: settings.submissionsOpen,
        shopOpen: settings.shopOpen,
        eventStartDate: settings.eventStartDate.toISOString(),
        airtableSyncEnabled: settings.airtableSyncEnabled,
        repoSyncEnabled: settings.repoSyncEnabled,
      },
    },
  })

  return ok({ settings })
})
