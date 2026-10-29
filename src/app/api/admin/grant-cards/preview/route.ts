import { ok } from "@/lib/api"
import { previewCardGrants } from "@/lib/grant-cards"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

/** The exact set and amount a bulk issue would pay, before any money moves. */
export const GET = withPermission(Permission.MANAGE_CREDIT, async () => ok(await previewCardGrants()))
