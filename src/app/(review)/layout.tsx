import type { Metadata, Viewport } from "next"
import { ReviewShell } from "@/components/review/ReviewShell"
import { WorldGuard } from "@/components/WorldGuard"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasAnyPermission, Permission } from "@/lib/permissions"
import { getStoreSnapshot } from "@/lib/queries/store"
import { StoreProvider } from "@/lib/store"
import "./review.css"

export const metadata: Metadata = {
	robots: { follow: false, index: false },
	title: { default: "Reviews · Half Life", template: "%s · Half Life reviews" },
}

export const viewport: Viewport = {
	colorScheme: "dark",
	initialScale: 1,
	themeColor: "#0a2b26",
	width: "device-width",
}

export const dynamic = "force-dynamic"

/**
 * The review platform's root layout – a fourth world beside the landing page, the platform and the phone handoff.
 *
 * Its own root layout because it is drawn in Fabricate's design system rather than Half Life's: a separate document with its own stylesheet, so neither world's tokens can repaint the other (see `WorldGuard`). Links into it from the rest of the app are plain anchors for the same reason – crossing worlds has to be a full page load.
 *
 * The left rail carries the platform sidebar's blocks in Fabricate's rail (`ReviewSidebar`), so a reviewer who is also a participant keeps one way around both. It reads the same store snapshot the platform's layout loads, and its links back into the platform are full page loads.
 *
 * The guard is the console's: REVIEW_SUBMISSIONS, and a 404 for anyone without it, so guessing the URL confirms nothing.
 */
export default async function ReviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	const context = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)
	const snapshot = await getStoreSnapshot(context.user.id)
	const seesAdmin = hasAnyPermission(context.roles, [
		Permission.VIEW_USERS,
		Permission.MANAGE_PROGRAM,
		Permission.MANAGE_CREDIT,
		Permission.VIEW_AUDIT_LOG,
	])

	return (
		<html lang="en">
			<body data-world="review">
				<WorldGuard world="review" />
				<StoreProvider snapshot={snapshot}>
					<ReviewShell admin={seesAdmin}>{children}</ReviewShell>
				</StoreProvider>
			</body>
		</html>
	)
}
