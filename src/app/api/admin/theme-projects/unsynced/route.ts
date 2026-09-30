import { findUnsyncedSubmissions } from "@/lib/airtable/sync"
import { ok, withRoute } from "@/lib/api"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export const GET = withRoute(async () => {
  const gate = await requirePermission(Permission.MANAGE_PROGRAM)
  if (gate.error) return gate.error
  return ok({ unsynced: await findUnsyncedSubmissions() })
})
