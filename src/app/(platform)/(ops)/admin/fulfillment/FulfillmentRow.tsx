"use client"

import Link from "next/link"
import { useState } from "react"
import { ManageButton, ManageRow, ManageSection } from "@/app/components/admin/ProjectManage"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { OrderDecision } from "@/app/components/forms/OrderDecision"
import { OrderFulfillment } from "@/app/components/forms/OrderFulfillment"
import { Badge } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { HcbGrantCardStatus, type ShopOrderStatus } from "@/lib/enums"
import { DELIVERY_LABELS, STAGE_LABELS } from "@/lib/fulfillment"
import type { FulfillmentOrderJson } from "@/lib/fulfillment-sheet"
import { formatUsd } from "@/lib/money"

const STATUS: { [_ in ShopOrderStatus]: { label: string; tone: "success" | "warning" | "danger" | "muted" } } = {
	CANCELLED: { label: "Cancelled by participant", tone: "muted" },
	FULFILLED: { label: "Fulfilled", tone: "success" },
	ON_HOLD: { label: "On hold", tone: "warning" },
	PENDING: { label: "Pending", tone: "warning" },
	REJECTED: { label: "Rejected", tone: "danger" },
}

/** Where a shop card grant has got to, in the words the person issuing it needs. */
const CARD_STATUS: { [_ in HcbGrantCardStatus]: { label: string; tone: "success" | "warning" | "danger" | "muted" } } =
	{
		AMBIGUOUS: { label: "Check on HCB", tone: "warning" },
		CANCELED: { label: "Cancelled", tone: "muted" },
		FAILED: { label: "Failed", tone: "danger" },
		ISSUED: { label: "Issued", tone: "success" },
		PENDING: { label: "In progress", tone: "warning" },
		RETURNED: { label: "Returned by the buyer", tone: "muted" },
		SKIPPED: { label: "Skipped", tone: "muted" },
	}

/** The sheet's address with a status added, keeping the filters already in it. */
function statusHref(filters: string, status: string): string {
	const params = new URLSearchParams(filters)
	params.set("status", status)
	return `/admin/fulfillment?${params.toString()}`
}

/**
 * One order on the fulfilment sheet, with every control folded into a manage panel beneath it.
 *
 * The table is a reading list: order number, who, what, what it cost and where it is. Method, stage, the decision and the record of what was decided are not columns – they are a panel, so the sheet has room for the orders rather than the forms. `filters` is the sheet's current query, so a row's status can set its own status in it.
 */
export function FulfillmentRow({ filters, order }: Readonly<{ filters: string; order: FulfillmentOrderJson }>) {
	const [open, setOpen] = useState(false)
	const active = order.status === "PENDING" || order.status === "ON_HOLD"
	const status = STATUS[order.status]
	const tracking = [order.trackingCarrier, order.trackingNumber].filter(Boolean).join(" ")
	const panelId = `order-manage-${order.id}`
	// The card's own amount is the one it was claimed with; the order's is what it would be issued for now.
	const cardCents = order.grantCard?.amountCents ?? order.grantCardCents
	const merchantIds = order.grantCard?.grantCardMerchantIds ?? order.grantCardMerchantIds
	const issueConfirm =
		cardCents === null
			? undefined
			: `Issue a ${formatUsd(cardCents / 100)} HCB card grant for order #${order.orderNumber}? HCB sends the card to the buyer's account.`

	return (
		<>
			<tr>
				<td className="hl-mono">{order.orderNumber}</td>
				<td className="hl-fulfill-participant">
					<Link className="hl-entity-name" href={`/admin/users/${order.user.id}`}>
						{order.user.name ?? "-"}
					</Link>
					<div className="hl-entity-links">
						<Link href={`/u/${order.user.id}`}>Public profile</Link>
					</div>
				</td>
				<td>
					<Link href={`/admin/shop/${order.shopItemId}`}>{order.itemNameSnapshot}</Link>
					{order.quantity > 1 ? <span className="hl-hint"> ×{order.quantity}</span> : null}
				</td>
				<td className="hl-mono">
					{order.totalUsd === null ? (
						<span className="hl-hint" title="No cost has been entered for this order">
							–
						</span>
					) : (
						formatUsd(order.totalUsd)
					)}
				</td>
				<td>
					{order.country ?? (
						<span className="hl-hint" title="No country on the shipping address">
							–
						</span>
					)}
				</td>
				<td className="hl-mono" title={formatUtcDateTime(new Date(order.placedAt))}>
					{formatUtcDateTime(new Date(order.placedAt))}
				</td>
				<td className="hl-fulfill-status">
					<Link href={statusHref(filters, order.status)} title={`Show only ${status.label.toLowerCase()} orders`}>
						<Badge tone={status.tone}>{status.label}</Badge>
					</Link>
					{order.deliveryPreference ? <div className="hl-hint">{DELIVERY_LABELS[order.deliveryPreference]}</div> : null}
					{order.grantCard ? <div className="hl-hint">Card: {CARD_STATUS[order.grantCard.status].label}</div> : null}
					{active ? <div className="hl-hint">{STAGE_LABELS[order.fulfillmentStage]}</div> : null}
					{tracking ? <div className="hl-hint hl-mono">{tracking}</div> : null}
					{order.status === "CANCELLED" && order.cancelledAt ? (
						<div className="hl-hint">{formatUtcDateTime(new Date(order.cancelledAt))}</div>
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
							<dd>{formatUtcDateTime(new Date(order.placedAt))}</dd>
						</div>
						<div>
							<dt>Stage</dt>
							<dd>{STAGE_LABELS[order.fulfillmentStage]}</dd>
						</div>
						{order.deliveryPreference ? (
							<div>
								<dt>Delivery</dt>
								<dd>{DELIVERY_LABELS[order.deliveryPreference]}</dd>
							</div>
						) : null}
						{order.fulfilledAt ? (
							<div>
								<dt>Fulfilled</dt>
								<dd>{formatUtcDateTime(new Date(order.fulfilledAt))}</dd>
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
								<dd>{formatUtcDateTime(new Date(order.cancelledAt))}</dd>
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
					{order.deliveryPreference === "GRANT_CARD" || order.grantCard ? (
						<div className="hl-stack hl-stack--tight" style={{ marginTop: "0.6rem" }}>
							<p className="hl-hint">Grant card</p>
							{cardCents === null ? (
								<p className="hl-hint">No amount was recorded on this order, so no card can be issued.</p>
							) : (
								<p className="hl-hint">{formatUsd(cardCents / 100)} to the buyer&rsquo;s HCB account.</p>
							)}
							{merchantIds.length > 0 ? (
								<p className="hl-hint">
									Usable only at merchant IDs: <span className="hl-mono">{merchantIds.join(", ")}</span>
								</p>
							) : null}
							{order.grantCard ? (
								<>
									<Badge tone={CARD_STATUS[order.grantCard.status].tone}>
										{CARD_STATUS[order.grantCard.status].label}
									</Badge>
									{order.grantCard.error ? <p className="hl-hint">{order.grantCard.error}</p> : null}
									{order.grantCard.hcbCardGrantId ? (
										<a
											className="hl-mono"
											href={`https://hcb.hackclub.com/grants/${order.grantCard.hcbCardGrantId}`}
											rel="noopener noreferrer"
											target="_blank"
										>
											{order.grantCard.hcbCardGrantId}
										</a>
									) : null}
								</>
							) : null}
							<div className="hl-row">
								{active && !order.grantCard && cardCents !== null ? (
									<ActionButton
										confirm={issueConfirm}
										label="Issue grant card"
										pendingLabel="Issuing…"
										url={`/api/admin/shop/orders/${order.id}/grant-card`}
									/>
								) : null}
								{order.grantCard?.status === HcbGrantCardStatus.FAILED
								|| order.grantCard?.status === HcbGrantCardStatus.SKIPPED ? (
									<ActionButton
										confirm={issueConfirm}
										label="Retry"
										pendingLabel="Issuing…"
										url={`/api/admin/shop/orders/${order.id}/grant-card`}
									/>
								) : null}
								{order.grantCard
								&& (order.grantCard.status === HcbGrantCardStatus.AMBIGUOUS
									|| order.grantCard.status === HcbGrantCardStatus.FAILED
									|| order.grantCard.status === HcbGrantCardStatus.PENDING) ? (
									<ActionButton
										label="Check HCB"
										pendingLabel="Checking…"
										url={`/api/admin/shop/grant-cards/${order.grantCard.id}/reconcile`}
									/>
								) : null}
								{order.grantCard?.hcbCardGrantId
								&& order.grantCard.status !== HcbGrantCardStatus.CANCELED
								&& order.grantCard.status !== HcbGrantCardStatus.RETURNED ? (
									<ActionButton
										confirm="Cancel this HCB card grant? Its remaining balance goes back to the organisation, and the order will not be paid again automatically."
										label="Cancel card"
										pendingLabel="Cancelling…"
										url={`/api/admin/shop/grant-cards/${order.grantCard.id}/cancel`}
										variant="danger"
									/>
								) : null}
							</div>
						</div>
					) : null}
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
