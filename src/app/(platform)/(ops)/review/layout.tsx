import Link from "next/link"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function ReviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	// 404s rather than 403s for anyone without the permission, so guessing at /review tells you nothing about whether it exists.
	const { user } = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)

	return (
		<>
			<nav className="hl-nav">
				<strong>Half-Life review</strong>
				<Link href="/review">Queue</Link>
				<Link href="/dashboard">Dashboard</Link>
				<span className="hl-muted" style={{ marginLeft: "auto" }}>
					{user.email}
				</span>
			</nav>
			<main className="hl-shell">{children}</main>
		</>
	)
}
