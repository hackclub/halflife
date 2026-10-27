"use client"

import Link from "next/link"
import { useState } from "react"
import { ManageButton, ManageRow, ManageSection } from "@/app/components/admin/ProjectManage"
import { OrderDecision } from "@/app/components/forms/OrderDecision"
import { OrderFulfillment } from "@/app/components/forms/OrderFulfillment"
import { Badge } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import type { ShopOrderStatus } from "@/lib/enums"
import { STAGE_LABELS } from "@/lib/fulfillment"
import { formatUsd } from "@/lib/money"
import type { FulfillmentOrderRow } from "@/lib/queries/admin"

const STATUS: Record<ShopOrderStatus, { label: string; tone: "success" | "warning" | "danger" | "muted" }> = {
	CANCELLED: { label: "Cancelled by participant", tone: "muted" },
	FULFILLED: { label: "Fulfilled", tone: "success" },
	ON_HOLD: { label: "On hold", tone: "warning" },
	PENDING: { label: "Pending", tone: "warning" },
	REJECTED: { label: "Rejected", tone: "danger" },
}

/**
 * One order on the fulfilment sheet, with every control folded into a manage panel beneath it.
 *
 * The table is a reading list: order number, who, what, what it cost and where it is. Method, stage, the decision and the record of what was decided are not columns – they are a panel, so the sheet has room for the orders rather than the forms.
 */
export function FulfillmentRow({ order }: Readonly<{ order: FulfillmentOrderRow }>) {
	const [open, setOpen] = useState(false)
	const active = order.status === "PENDING" || order.status === "ON_HOLD"
	const status = STATUS[order.status]
	const tracking = [order.trackingCarrier, order.trackingNumber].filter(Boolean).join(" ")
	const panelId = `order-manage-${order.id}`

	return (
		<>
			<tr>
				<td className="hl-mono">{order.orderNumber}</td>
				<td style={{ minWidth: "12rem" }}>
					<span className="hl-entity-name">{order.user.name ?? "-"}</span>
					<div className="hl-entity-links">
						<Link href={`/admin/users/${order.user.id}`}>Admin user</Link>
						<Link href={`/u/${order.user.id}`}>Public profile</Link>
					</div>
				</td>
				<td>
					{order.itemNameSnapshot}
					{order.quantity > 1 ? <span className="hl-hint"> ×{order.quantity}</span> : null}
				</td>
				<td className="hl-mono">
					{order.totalUsd === null ? <span className="hl-hint">not set</span> : formatUsd(order.totalUsd)}
				</td>
				<td>{order.country ?? <span className="hl-hint">unknown</span>}</td>
				<td className="hl-mono">{formatUtcDateTime(order.placedAt)}</td>
				<td style={{ minWidth: "10rem" }}>
					<Badge tone={status.tone}>{status.label}</Badge>
					{active ? <div className="hl-hint">{STAGE_LABELS[order.fulfillmentStage]}</div> : null}
					{tracking ? <div className="hl-hint hl-mono">{tracking}</div> : null}
					{order.status === "CANCELLED" && order.cancelledAt ? (
						<div className="hl-hint">{formatUtcDateTime(order.cancelledAt)}</div>
					) : null}
				</td>
				<td>
					<ManageButton
						label={active ? "Manage" : "View"}
						onToggle={() => setOpen(value => !value)}
						open={open}
						panelId={panelId}
					/>
				</td>
			</tr>
			<ManageRow columns={8} id={panelId} open={open}>
				<ManageSection title="Details">
					<dl className="hl-detail-list">
						<div>
							<dt>Order</dt>
							<dd className="hl-mono">{order.id}</dd>
						</div>
						<div>
							<dt>Quantity</dt>
							<dd>{order.quantity}</dd>
						</div>
						<div>
							<dt>Cost</dt>
							<dd>{order.totalUsd === null ? "not set" : formatUsd(order.totalUsd)}</dd>
						</div>
						<div>
							<dt>Country</dt>
							<dd>{order.country ?? "unknown"}</dd>
						</div>
						<div>
							<dt>Placed</dt>
							<dd>{formatUtcDateTime(order.placedAt)}</dd>
						</div>
						<div>
							<dt>Stage</dt>
							<dd>{STAGE_LABELS[order.fulfillmentStage]}</dd>
						</div>
						{order.fulfilledAt ? (
							<div>
								<dt>Fulfilled</dt>
								<dd>{formatUtcDateTime(order.fulfilledAt)}</dd>
							</div>
						) : null}
						{tracking ? (
							<div>
								<dt>Tracking</dt>
								<dd className="hl-mono">{tracking}</dd>
							</div>
						) : null}
						{order.cancelledAt ? (
							<div>
								<dt>Cancelled</dt>
								<dd>{formatUtcDateTime(order.cancelledAt)}</dd>
							</div>
						) : null}
						{order.cancellationReason ? (
							<div>
								<dt>Reason</dt>
								<dd>{order.cancellationReason}</dd>
							</div>
						) : null}
						{order.rejectionReason ? (
							<div>
								<dt>Refusal</dt>
								<dd>{order.rejectionReason}</dd>
							</div>
						) : null}
						{order.holdReason ? (
							<div>
								<dt>On hold</dt>
								<dd>{order.holdReason}</dd>
							</div>
						) : null}
					</dl>
				</ManageSection>

				<ManageSection title="Fulfilment">
					<OrderFulfillment
						cancelled={order.status === "CANCELLED"}
						method={order.fulfillmentMethod}
						orderId={order.id}
						stage={order.fulfillmentStage}
					/>
				</ManageSection>

				<ManageSection title="Decision">
					{active ? (
						<OrderDecision orderId={order.id} />
					) : (
						<p className="hl-hint">
							{order.status === "CANCELLED"
								? "The participant cancelled this order; the coins were refunded."
								: order.status === "FULFILLED"
									? "This order was fulfilled. No further decision is needed."
									: "This order was rejected and refunded."}
						</p>
					)}
				</ManageSection>
			</ManageRow>
		</>
	)
}
