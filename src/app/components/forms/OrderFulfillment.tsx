"use client"
import { Callout } from "@/app/components/ui"
import type { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/app/generated/prisma/enums"
import { METHOD_LABELS, STAGE_LABELS } from "@/lib/fulfillment"
import { sendJson, useAction } from "@/lib/use-action"

/** The two markings on one order, each saved the moment it changes. */
export function OrderFulfillment({
	orderId,
	method,
	stage,
	cancelled,
}: Readonly<{
	orderId: string
	method: ShopFulfillmentMethod | null
	stage: ShopFulfillmentStage
	/** Cancelled by the participant: the stage is fixed. */
	cancelled: boolean
}>) {
	const { busy, error, run } = useAction()

	function save(body: { method?: ShopFulfillmentMethod | null; stage?: ShopFulfillmentStage }) {
		void run("save", () => sendJson(`/api/admin/shop/orders/${orderId}/fulfillment`, { method: "PATCH", body }))
	}

	return (
		<div className="hl-stack hl-stack--tight" style={{ gap: "0.4rem" }}>
			<select
				className="hl-select"
				aria-label="Shipping method"
				value={method ?? ""}
				disabled={busy !== null}
				onChange={e => save({ method: e.target.value === "" ? null : (e.target.value as ShopFulfillmentMethod) })}
			>
				<option value="">Method not chosen</option>
				{Object.entries(METHOD_LABELS).map(([value, label]) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
			<select
				className="hl-select"
				aria-label="Fulfilment stage"
				value={stage}
				disabled={busy !== null || cancelled}
				onChange={e => save({ stage: e.target.value as ShopFulfillmentStage })}
			>
				{Object.entries(STAGE_LABELS).map(([value, label]) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
