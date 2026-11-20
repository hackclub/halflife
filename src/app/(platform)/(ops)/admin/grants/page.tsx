import type { Metadata } from "next"
import Link from "next/link"
import { ExcludedGrantList } from "@/app/components/admin/ExcludedGrantList"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { ExportGrantCardsCsvForm } from "@/app/components/forms/ExportGrantCardsCsvForm"
import { HcbConnectForm } from "@/app/components/forms/HcbConnectForm"
import { IssueGrantCardsForm } from "@/app/components/forms/IssueGrantCardsForm"
import { Badge, EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { themeLabel } from "@/lib/config/program"
import { formatUtcDateTime } from "@/lib/deadline"
import { HcbGrantCardBatchStatus, PayoutSource } from "@/lib/enums"
import { listGrantCardBatches, listGrantCardExports, listIssuedGrantCards, previewCardGrants } from "@/lib/grant-cards"
import { readStoredRefreshToken } from "@/lib/hcb-credential"
import { hcbGrantUrl } from "@/lib/hcb-grant-url"
import { formatUsd } from "@/lib/money"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const metadata: Metadata = {
	title: "Grant cards",
}

export const dynamic = "force-dynamic"

const BATCH_TONE: { [_: string]: "success" | "warning" | "danger" | "muted" } = {
	COMPLETED: "success",
	FAILED: "danger",
	PARTIAL: "warning",
	PROCESSING: "warning",
}

/** The tabs in the order the chips and the [ and ] keys step through them. */
const TABS = [
	{ id: "issue", label: "Issue" },
	{ id: "ready", label: "Ready" },
	{ id: "excluded", label: "Excluded" },
	{ id: "batches", label: "Batches" },
	{ id: "issued", label: "Issued" },
] as const

type GrantTab = (typeof TABS)[number]["id"]

const tabHref = (id: GrantTab) => (id === "issue" ? "/admin/grants" : `/admin/grants?tab=${id}`)

interface Props {
	searchParams: Promise<{ tab?: SearchParamValue }>
}

export default async function AdminGrantsPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.MANAGE_CREDIT)
	// The tab, taken as the single value the URL named: a repeated parameter arrives as an array, which is not a tab.
	const { tab: requestedTab } = firstValues(await searchParams)
	const tab: GrantTab = TABS.find(item => item.id === requestedTab)?.id ?? "issue"

	const [preview, batches, csvExports, hcbConnected, issued] = await Promise.all([
		previewCardGrants(),
		listGrantCardBatches(20),
		listGrantCardExports(20),
		readStoredRefreshToken(),
		listIssuedGrantCards(),
	])

	const hrefs = TABS.map(item => tabHref(item.id))
	const counts: { [_ in GrantTab]?: number } = {
		excluded: preview.excluded.length,
		issued: issued.length,
		ready: preview.eligible.length,
	}

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader
				actions={
					<div className="hl-row">
						{TABS.map(item => (
							<Link
								aria-current={item.id === tab || undefined}
								className="hl-chip"
								href={tabHref(item.id)}
								key={item.id}
							>
								{item.label}
								{counts[item.id] === undefined ? null : (
									<>
										{" "}
										<span className="hl-count">{counts[item.id]}</span>
									</>
								)}
							</Link>
						))}
					</div>
				}
				compact
				subtitle="Issue HCB card grants for approved designs. The amount is each project's BOM total."
				title="Grant cards"
			/>
			<TabKeys current={tabHref(tab)} hrefs={hrefs} />

			<div className="hl-row">
				<Stat label="Ready to issue" value={preview.eligible.length} />
				<Stat label="Batch total" value={formatUsd(preview.totalCents / 100)} />
				<Stat label="HCB balance" value={preview.balanceCents === null ? "-" : formatUsd(preview.balanceCents / 100)} />
				<Stat label="Payout source" value={preview.payoutSource === PayoutSource.HCB ? "HCB" : "Airtable"} />
			</div>

			{tab === "issue" ? (
				<>
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

					<Panel title="HCB connection">
						<p className="hl-hint">
							Half Life pays from the HCB organisation through an OAuth application. Connecting stores a rotating
							refresh token on this deployment; HCB must be connected before cards can be issued.
						</p>
						<HcbConnectForm connected={hcbConnected !== null} />
					</Panel>

					<div className="hl-grant-pair">
						<Panel title="Issue card grants">
							<IssueGrantCardsForm initial={preview} />
						</Panel>

						<Panel title="HCB CSV import">
							<p className="hl-hint">
								No HCB API token? Generate an import file instead: it carries the same ready projects and amounts, and
								uploading it on HCB creates the cards there.
							</p>
							<ExportGrantCardsCsvForm
								initial={{
									eligibleCount: preview.eligible.length,
									fingerprint: preview.fingerprint,
									payoutSource: preview.payoutSource,
									totalCents: preview.totalCents,
								}}
							/>
						</Panel>
					</div>
				</>
			) : null}

			{tab === "ready" ? (
				<Panel title="Ready projects" wide>
					{preview.eligible.length === 0 ? (
						<EmptyState>No approved project is ready for a card grant.</EmptyState>
					) : (
						<Table head={["Project", "Maker", "Theme", "BOM", "Lines", "Tier grant"]}>
							{preview.eligible.map(row => (
								<tr key={row.projectId}>
									<td>
										<Link href={`/admin/users/${row.ownerId}?tab=projects#project-${row.projectId}`}>
											{row.title || "Untitled"}
										</Link>
										<div className="hl-hint hl-mono">{row.projectId}</div>
									</td>
									<td>{row.ownerName}</td>
									<td>{themeLabel(row.theme)}</td>
									<td className="hl-mono">{formatUsd(row.amountCents / 100)}</td>
									<td className="hl-mono">{row.bomLineCount}</td>
									<td className="hl-mono">{row.grantUsd === null ? "-" : formatUsd(row.grantUsd)}</td>
								</tr>
							))}
						</Table>
					)}
				</Panel>
			) : null}

			{tab === "excluded" ? (
				<Panel title="Excluded" wide>
					{preview.excluded.length === 0 ? (
						<EmptyState>No project was left out of the batch.</EmptyState>
					) : (
						<ExcludedGrantList rows={preview.excluded} />
					)}
				</Panel>
			) : null}

			{tab === "batches" ? (
				<>
					<Panel title="Generated CSV files" wide>
						{csvExports.length === 0 ? (
							<EmptyState>No import file has been generated yet.</EmptyState>
						) : (
							<Table head={["File", "Generated", "Cards", "Total", ""]}>
								{csvExports.map(csvExport => (
									<tr key={csvExport.batchId}>
										<td className="hl-mono">{csvExport.batchId}</td>
										<td>{formatUtcDateTime(csvExport.createdAt)}</td>
										<td className="hl-mono">{csvExport.count}</td>
										<td className="hl-mono">{formatUsd(csvExport.totalCents / 100)}</td>
										<td>
											<a href={`/api/admin/grant-cards/exports/${csvExport.batchId}/download`}>Download CSV</a>
										</td>
									</tr>
								))}
							</Table>
						)}
					</Panel>

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
										<td>{formatUtcDateTime(batch.createdAt)}</td>
										<td>
											<Badge tone={BATCH_TONE[batch.status] ?? "muted"}>
												{batch.status === HcbGrantCardBatchStatus.PROCESSING
													? "processing"
													: batch.status.toLowerCase()}
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
				</>
			) : null}

			{tab === "issued" ? (
				<Panel title="Issued cards" wide>
					{issued.length === 0 ? (
						<EmptyState>No card grant has been issued yet.</EmptyState>
					) : (
						<Table head={["Project", "Amount", "Issued", "HCB grant", "Batch"]}>
							{issued.map(card => (
								<tr id={`card-${card.id}`} key={card.id}>
									<td>
										{card.title || "Untitled"}
										<div className="hl-hint hl-mono">{card.projectId}</div>
									</td>
									<td className="hl-mono">{formatUsd(card.amountCents / 100)}</td>
									<td>{card.issuedAt ? formatUtcDateTime(card.issuedAt) : "-"}</td>
									<td className="hl-mono">
										{card.hcbCardGrantId ? <a href={hcbGrantUrl(card.hcbCardGrantId)}>{card.hcbCardGrantId}</a> : "-"}
									</td>
									<td>
										<Link className="hl-mono" href={`/admin/grants/${card.batchId}`}>
											{card.batchId}
										</Link>
									</td>
								</tr>
							))}
						</Table>
					)}
				</Panel>
			) : null}
		</div>
	)
}
