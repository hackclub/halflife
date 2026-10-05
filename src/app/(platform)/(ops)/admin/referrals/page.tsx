import Link from "next/link"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getReferralLeaderboard } from "@/lib/site/referrals"

export const dynamic = "force-dynamic"

export default async function AdminReferralsPage() {
	await requirePermissionPage(Permission.VIEW_USERS)

	const board = await getReferralLeaderboard()

	return (
		<div className="hl-stack">
			<PageHeader
				title="Referrals"
				subtitle="Ranked by the sign-ups each ?ref= link has brought in, from the landing page sign-up list."
			/>

			{board === null ? (
				<Panel>
					<EmptyState>
						Referral numbers live on the sign-up list, and Airtable is not configured here, so there is nothing to show.
					</EmptyState>
				</Panel>
			) : (
				<>
					<div className="hl-row">
						<Stat label="Referred sign-ups" value={board.referred} />
						<Stat label="Links with a sign-up" value={board.activeCodes} />
					</div>

					<Panel
						title="Top referral links"
						actions={
							<span className="hl-hint" style={{ fontSize: "0.78rem" }}>
								cached for a minute
							</span>
						}
					>
						{board.rows.length === 0 ? (
							<EmptyState>No sign-up has come through a referral link yet.</EmptyState>
						) : (
							<Table head={["#", "Referrer", "Code", "Sign-ups"]}>
								{board.rows.map((row, index) => (
									<tr key={row.code}>
										<td className="hl-hint hl-mono">{index + 1}</td>
										<td>
											{row.email ? (
												<Link href={`/admin/users?q=${encodeURIComponent(row.email)}`} className="hl-mono">
													{row.email}
												</Link>
											) : (
												<span className="hl-hint">unknown referrer</span>
											)}
										</td>
										<td className="hl-mono">{row.code}</td>
										<td className="hl-mono">{row.signups}</td>
									</tr>
								))}
							</Table>
						)}
					</Panel>
				</>
			)}
		</div>
	)
}
