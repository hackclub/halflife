import Link from "next/link"
import { IssueGrantCardsForm } from "@/app/components/forms/IssueGrantCardsForm"
import { Badge, EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { getThemeDef } from "@/lib/config/program"
import { HcbGrantCardBatchStatus, PayoutSource } from "@/lib/enums"
import { listGrantCardBatches, previewCardGrants } from "@/lib/grant-cards"
import { formatUsd } from "@/lib/money"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

const BATCH_TONE: { [_: string]: "success" | "warning" | "danger" | "muted" } = {
	COMPLETED: "success",
	FAILED: "danger",
	PARTIAL: "warning",
	PROCESSING: "warning",
}

export default async function AdminGrantsPage() {
	await requirePermissionPage(Permission.MANAGE_CREDIT)

	const [preview, batches] = await Promise.all([previewCardGrants(), listGrantCardBatches(20)])

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader
				subtitle="Issue HCB card grants for approved designs. The amount is each project's BOM total."
				title="Grant cards"
			/>

			<div className="hl-row">
				<Stat label="Ready to issue" value={preview.eligible.length} />
				<Stat label="Batch total" value={formatUsd(preview.totalCents / 100)} />
				<Stat
					label="HCB balance"
					value={preview.balanceCents === null ? "-" : formatUsd(preview.balanceCents / 100)}
				/>
				<Stat label="Payout source" value={preview.payoutSource === PayoutSource.HCB ? "HCB" : "Airtable"} />
			</div>

			<Panel title="Payout source">
				{preview.payoutSource === PayoutSource.HCB ? (
					<p className="hl-hint" style={{ margin: 0 }}>
						HCB owns payouts. Airtable rows are still written for review and Loops, with a zero requested funding so
						the YSWS pipeline cannot pay the same project again.
					</p>
				) : (
					<p className="hl-hint" style={{ margin: 0 }}>
						Payouts are still set to Airtable, so card issuing is locked. Change the source in{" "}
						<Link href="/admin/program">Program settings</Link> once the YSWS pipeline is paused and existing
						approved rows have been made non-payable.
					</p>
				)}
				{preview.balanceError ? <p className="hl-hint hl-mono">{preview.balanceError}</p> : null}
			</Panel>

			<Panel title="Issue card grants">
				<IssueGrantCardsForm initial={preview} />
			</Panel>

			<Panel title="Ready projects" wide>
				{preview.eligible.length === 0 ? (
					<EmptyState>No approved project is ready for a card grant.</EmptyState>
				) : (
					<Table head={["Project", "Maker", "Theme", "BOM", "Lines", "Tier grant"]}>
						{preview.eligible.map(row => (
							<tr key={row.projectId}>
								<td>
									<Link href={`/admin/users/${row.ownerId}#project-${row.projectId}`}>
										{row.title || "Untitled"}
									</Link>
									<div className="hl-hint hl-mono">{row.projectId}</div>
								</td>
								<td>{row.ownerName}</td>
								<td>{getThemeDef(row.theme).label}</td>
								<td className="hl-mono">{formatUsd(row.amountCents / 100)}</td>
								<td className="hl-mono">{row.bomLineCount}</td>
								<td className="hl-mono">{row.grantUsd === null ? "-" : formatUsd(row.grantUsd)}</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			{preview.excluded.length > 0 ? (
				<Panel title="Excluded" wide>
					<Table head={["Project", "Maker", "Reason"]}>
						{preview.excluded.map(row => (
							<tr key={row.projectId}>
								<td>
									{row.title || "Untitled"}
									<div className="hl-hint hl-mono">{row.projectId}</div>
								</td>
								<td>{row.ownerName}</td>
								<td>{row.reason}</td>
							</tr>
						))}
					</Table>
				</Panel>
			) : null}

			<Panel title="Recent batches" wide>
				{batches.length === 0 ? (
					<EmptyState>No card grants have been issued yet.</EmptyState>
				) : (
					<Table head={["Batch", "Created", "Status", "Total", "Issued", "Failed", "Ambiguous", "Skipped"]}>
						{batches.map(batch => (
							<tr key={batch.id}>
								<td>
									<Link className="hl-mono" href={`/admin/grants/${batch.id}`}>
										{batch.id}
									</Link>
								</td>
								<td>{batch.createdAt.toLocaleString()}</td>
								<td>
									<Badge tone={BATCH_TONE[batch.status] ?? "muted"}>
										{batch.status === HcbGrantCardBatchStatus.PROCESSING ? "processing" : batch.status.toLowerCase()}
									</Badge>
								</td>
								<td className="hl-mono">{formatUsd(batch.totalCents / 100)}</td>
								<td className="hl-mono">{batch.issuedCount}</td>
								<td className="hl-mono">{batch.failedCount}</td>
								<td className="hl-mono">{batch.ambiguousCount}</td>
								<td className="hl-mono">{batch.skippedCount}</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</div>
	)
}
