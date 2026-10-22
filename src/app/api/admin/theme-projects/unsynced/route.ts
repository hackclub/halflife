import { findUnsyncedSubmissions } from "@/lib/airtable/sync"
import { ok } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export const GET = withPermission(Permission.MANAGE_PROGRAM, async () =>
	ok({ unsynced: await findUnsyncedSubmissions() }),
)
