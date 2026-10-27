"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Chip, Panel } from "@/components/platform/ui"
import { errorMessage, refusalMessage } from "@/lib/api-error"
import type { ShopOrderStatus } from "@/lib/enums"
import { STAGE_LABELS } from "@/lib/fulfillment"
import type { ShopOrderPublic } from "@/lib/shop"
import { canCancelOrder, cancelBlockedReason } from "@/lib/shop-order"

const STATUS: Record<ShopOrderStatus, { label: string; tone: "sky" | "gold" | "teal" | "coral" | "muted" }> = {
	CANCELLED: { label: "Cancelled", tone: "muted" },
	FULFILLED: { label: "Fulfilled", tone: "teal" },
	ON_HOLD: { label: "On hold", tone: "gold" },
	PENDING: { label: "Pending", tone: "sky" },
	REJECTED: { label: "Rejected", tone: "coral" },
}

const when = (date: Date | null): string | null =>
	date ? date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null

/**
 * A participant's order history, with the one change they can make from it: cancelling an order that has not been acted on.
 *
 * Everything that changes an order is the server's decision, so a successful cancel ends in a refresh rather than a local patch: the status, the refunded coins and the shelf's "Ordered" state all come back from the same read.
 */
export function OrdersList({ orders }: { orders: ShopOrderPublic[] }) {
	const router = useRouter()
	const [busy, setBusy] = useState<string | null>(null)
	const [confirming, setConfirming] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	async function cancel(order: ShopOrderPublic) {
		if (busy) return

		setBusy(order.id)
		setError(null)
		setNotice(null)
		try {
			const res = await fetch(`/api/shop/orders/${order.id}/cancel`, {
				body: JSON.stringify({}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload: unknown = await res.json().catch(() => null)
			if (!res.ok) {
				setError(errorMessage(payload, refusalMessage(res.status, "That order could not be cancelled")))
				return
			}
			setConfirming(null)
			setNotice(`Order #${order.orderNumber} cancelled. ${order.totalCredits} coins are back in your balance.`)
			router.refresh()
		} catch {
			setError("Could not reach the server. Your order is unchanged. Try again.")
		} finally {
			setBusy(null)
		}
	}

	if (orders.length === 0)
		return (
			<Panel className="bg-paper px-6 py-14 text-center" radius={20} tone="line">
				<p className="text-[1.05rem] font-extrabold text-navy">No orders yet</p>
				<p className="hand mx-auto mt-2 max-w-[44ch] text-[0.9rem] leading-relaxed text-navy-soft">
					coins you spend in the shop show up here, with how far each order has got.
				</p>
			</Panel>
		)

	return (
		<div className="grid gap-3">
			{error && (
				<p
					className="rounded-xl border-2 border-coral bg-cream px-4 py-3 text-[0.9rem] font-semibold text-coral-deep"
					role="alert"
				>
					{error}
				</p>
			)}
			{notice && (
				<p className="rounded-xl border-2 border-teal-deep/30 bg-mint/40 px-4 py-3 text-[0.9rem] font-semibold text-teal-ink">
					{notice}
				</p>
			)}
			<ul className="grid gap-3">
				{orders.map(order => {
					const status = STATUS[order.status]
					const cancelable = canCancelOrder(order)
					const placed = when(order.placedAt)
					const cancelled = when(order.cancelledAt)
					const rejected = when(order.rejectedAt)
					const fulfilled = when(order.fulfilledAt)
					const stage = order.fulfillmentStage
					return (
						<li key={order.id}>
							<Panel className="bg-paper p-4 sm:p-5" radius={18} tone="line">
								<div className="flex flex-wrap items-start justify-between gap-3">
									<div className="min-w-0">
										<p className="label text-navy-faint">Order #{order.orderNumber}</p>
										<h2 className="mt-0.5 text-[1.05rem] leading-tight font-extrabold text-navy">
											{order.itemNameSnapshot}
											{order.quantity > 1 && <span className="text-navy-soft"> ×{order.quantity}</span>}
										</h2>
										<p className="hand mt-1 text-[0.82rem] text-navy-soft">
											placed {placed} · {order.totalCredits} coin{order.totalCredits === 1 ? "" : "s"}
										</p>
									</div>
									<Chip tone={status.tone}>{status.label}</Chip>
								</div>

								<div className="mt-3 grid gap-1.5 text-[0.85rem] leading-snug text-navy-soft">
									{order.status === "PENDING" || order.status === "ON_HOLD" ? (
										<p>
											{stage === "UNFULFILLED"
												? "Not ordered from the shop yet."
												: `Fulfilment: ${STAGE_LABELS[stage].toLowerCase()}.`}
										</p>
									) : null}
									{order.status === "FULFILLED" ? (
										<p>
											Fulfilled{fulfilled ? ` on ${fulfilled}` : ""}.
											{order.trackingNumber
												? ` Tracking ${order.trackingNumber}${order.trackingCarrier ? ` (${order.trackingCarrier})` : ""}.`
												: ""}
										</p>
									) : null}
									{order.status === "CANCELLED" ? (
										<p>
											Cancelled{cancelled ? ` on ${cancelled}` : ""}. The coins are back in your balance.
											{order.cancellationReason ? ` “${order.cancellationReason}”` : ""}
										</p>
									) : null}
									{order.status === "REJECTED" ? (
										<p>
											Rejected{rejected ? ` on ${rejected}` : ""} and refunded.
											{order.rejectionReason ? ` “${order.rejectionReason}”` : ""}
										</p>
									) : null}
									{cancelable ? (
										<p>You can cancel this until staff order it. Your coins are refunded in full.</p>
									) : order.status === "PENDING" || order.status === "ON_HOLD" ? (
										<p>{cancelBlockedReason(order)}</p>
									) : null}
								</div>

								{cancelable && (
									<div className="mt-3 flex flex-wrap items-center justify-end gap-2">
										{confirming === order.id ? (
											<>
												<p className="hand mr-auto text-[0.82rem] leading-snug text-navy-soft">
													Cancel order #{order.orderNumber} and get {order.totalCredits} coins back?
												</p>
												<Button disabled={busy !== null} onClick={() => setConfirming(null)} size="sm" variant="ghost">
													Keep it
												</Button>
												<Button disabled={busy !== null} onClick={() => cancel(order)} size="sm" variant="coral">
													{busy === order.id ? "Cancelling…" : "Cancel and refund"}
												</Button>
											</>
										) : (
											<Button
												disabled={busy !== null}
												onClick={() => setConfirming(order.id)}
												size="sm"
												variant="outline"
											>
												Cancel order
											</Button>
										)}
									</div>
								)}
							</Panel>
						</li>
					)
				})}
			</ul>
		</div>
	)
}
