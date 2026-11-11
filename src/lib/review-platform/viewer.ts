import "server-only"
import { displayName } from "@/lib/display-name"
import type { PageContext } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import type { ReviewViewer } from "@/lib/review-platform/types"

/**
 * What the signed-in reviewer may see and do on the review platform, from their roles.
 *
 * The same lines the console draws (`app/(platform)/(ops)/review/[id]/page.tsx`): contact details for ADMIN and AUDITOR, risk flags for those and for REVIEW_HOURS holders. These only decide what the server puts in the page; every write is checked again by the route it goes to.
 */
export function reviewViewerFor({ roles, user }: PageContext): ReviewViewer {
	const admin = hasRole(roles, Role.ADMIN)
	const auditor = hasRole(roles, Role.AUDITOR)
	return {
		canOverride: hasPermission(roles, Permission.OVERRIDE_DECISIONS),
		canReviewHours: hasPermission(roles, Permission.REVIEW_HOURS),
		canSetGrant: hasPermission(roles, Permission.MANAGE_CREDIT),
		displayName: displayName(user, "Reviewer"),
		id: user.id,
		isAdmin: admin,
		seesContact: admin || auditor,
		seesRiskFlags: admin || auditor || hasPermission(roles, Permission.REVIEW_HOURS),
	}
}
