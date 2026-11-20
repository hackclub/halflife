import { ok } from "@/lib/api"
import { withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { offlineAssetPaths } from "@/lib/review-platform/offline"

export const dynamic = "force-dynamic"

/** The build files a reviewer's browser keeps so the review screen still starts with no connection (see `offlineAssetPaths`). */
export const GET = withPermission(Permission.REVIEW_SUBMISSIONS, async () => ok({ assets: await offlineAssetPaths() }))
