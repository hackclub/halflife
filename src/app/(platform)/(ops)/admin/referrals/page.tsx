import Link from "next/link"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { Role } from "@/lib/enums"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission } from "@/lib/permissions"
import { getReferralLeaderboard } from "@/lib/site/referrals"

export const dynamic = "force-dynamic"

export default async function AdminReferralsPage() {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)

	// Referrer emails are landing-page sign-up PII: ADMIN/AUDITOR see them (with the user lookup), everyone else on VIEW_USERS gets the counts without the addresses.
	const showEmails = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)

	const board = await getReferralLeaderboard()

	return (
		<div className="hl-stack">
			<PageHeader
				subtitle="Ranked by the sign-ups each ?ref= link has brought in, from the landing page sign-up list."
				title="Referrals"
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
						actions={
							<span className="hl-hint" style={{ fontSize: "0.78rem" }}>
								cached for a minute
							</span>
						}
						title="Top referral links"
					>
						{board.rows.length === 0 ? (
							<EmptyState>No sign-up has come through a referral link yet.</EmptyState>
						) : (
							<Table head={["#", "Referrer", "Code", "Sign-ups"]}>
								{board.rows.map((row, index) => (
									<tr key={row.code}>
										<td className="hl-hint hl-mono">{index + 1}</td>
										<td>
											{row.email && showEmails ? (
												<Link className="hl-mono" href={`/admin/users?q=${encodeURIComponent(row.email)}`}>
													{row.email}
												</Link>
											) : row.email ? (
												<span className="hl-hint">a referrer</span>
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
