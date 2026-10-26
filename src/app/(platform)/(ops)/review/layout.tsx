import Link from "next/link"
import { OpsShell } from "@/app/components/OpsShell"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function ReviewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	// 404s rather than 403s for anyone without the permission, so guessing at /review tells you nothing about whether it exists.
	const { user } = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)

	return (
		<OpsShell
			email={user.email}
			nav={
				<>
					<Link href="/review">Queue</Link>
					<Link href="/dashboard">Dashboard</Link>
				</>
			}
			title="Half-Life review"
		>
			{children}
		</OpsShell>
	)
}
