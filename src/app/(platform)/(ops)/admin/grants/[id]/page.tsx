import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Badge, EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { HcbGrantCardStatus } from "@/lib/enums"
import { getGrantCardBatch } from "@/lib/grant-cards"
import { formatUsd } from "@/lib/money"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"

export const dynamic = "force-dynamic"

const STATUS_TONE: { [_: string]: "success" | "warning" | "danger" | "muted" } = {
	AMBIGUOUS: "warning",
	CANCELED: "muted",
	FAILED: "danger",
	ISSUED: "success",
	PENDING: "warning",
	SKIPPED: "muted",
}

interface Props {
	params: Promise<{ id: string }>
}

export default async function GrantCardBatchPage({ params }: Props) {
	await requirePermissionPage(Permission.MANAGE_CREDIT)
	const { id } = await params
	const batch = await getGrantCardBatch(id)
	if (!batch) notFound()

	const remaining = batch.cards.filter(card => card.status === HcbGrantCardStatus.PENDING).length
	const issuedCents = batch.cards
		.filter(card => card.status === HcbGrantCardStatus.ISSUED)
		.reduce((total, card) => total + card.amountCents, 0)

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader subtitle={<Link href="/admin/grants">Back to grant cards</Link>} title="Grant card batch" />

			<div className="hl-row">
				<Stat label="Total" value={formatUsd(batch.totalCents / 100)} />
				<Stat label="Issued" value={`${batch.issuedCount} · ${formatUsd(issuedCents / 100)}`} />
				<Stat label="Failed" value={batch.failedCount} />
				<Stat label="Ambiguous" value={batch.ambiguousCount} />
				<Stat label="Pending" value={remaining} />
			</div>

			<Panel>
				<p className="hl-hint" style={{ margin: 0 }}>
					Created {batch.createdAt.toLocaleString()}
					{batch.completedAt ? `, finished ${batch.completedAt.toLocaleString()}` : ""}. Batch{" "}
					<span className="hl-mono">{batch.id}</span>.
				</p>
				{remaining > 0 ? (
					<ActionButton
						body={{}}
						label="Resume batch"
						pendingLabel="Resuming…"
						url={`/api/admin/grant-cards/batches/${batch.id}/process`}
						variant="primary"
					/>
				) : null}
			</Panel>

			<Panel title="Grants" wide>
				{batch.cards.length === 0 ? (
					<EmptyState>This batch has no grants.</EmptyState>
				) : (
					<Table head={["Project", "Amount", "Status", "HCB grant", "Error", "Actions"]}>
						{batch.cards.map(card => (
							<tr key={card.id}>
								<td>
									{card.title || "Untitled"}
									<div className="hl-hint hl-mono">{card.projectId}</div>
								</td>
								<td className="hl-mono">{formatUsd(card.amountCents / 100)}</td>
								<td>
									<Badge tone={STATUS_TONE[card.status] ?? "muted"}>{card.status.toLowerCase()}</Badge>
								</td>
								<td className="hl-mono">
									{card.hcbCardGrantId ? (
										<a href={`https://hcb.hackclub.com/grants/${card.hcbCardGrantId}`}>{card.hcbCardGrantId}</a>
									) : (
										"-"
									)}
								</td>
								<td className="hl-hint">{card.error ?? "-"}</td>
								<td>
									<div className="hl-row">
										{card.status === HcbGrantCardStatus.AMBIGUOUS || card.status === HcbGrantCardStatus.FAILED ? (
											<ActionButton
												label="Check HCB"
												pendingLabel="Checking…"
												url={`/api/admin/grant-cards/${card.id}/reconcile`}
											/>
										) : null}
										{card.hcbCardGrantId && card.status !== HcbGrantCardStatus.CANCELED ? (
											<ActionButton
												confirm="Cancel this HCB card grant and return its remaining balance to the organisation?"
												label="Cancel"
												pendingLabel="Cancelling…"
												url={`/api/admin/grant-cards/${card.id}/cancel`}
												variant="danger"
											/>
										) : null}
									</div>
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</div>
	)
}
