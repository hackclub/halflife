"use client"
import { Callout } from "@/app/components/ui"
import type { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/lib/enums"
import { METHOD_LABELS, STAGE_LABELS } from "@/lib/fulfillment"
import { sendJson, useAction } from "@/lib/use-action"

const isFulfillmentMethod = (value: string): value is ShopFulfillmentMethod => Object.hasOwn(METHOD_LABELS, value)
const isFulfillmentStage = (value: string): value is ShopFulfillmentStage => Object.hasOwn(STAGE_LABELS, value)

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
		void run("save", () => sendJson(`/api/admin/shop/orders/${orderId}/fulfillment`, { body, method: "PATCH" }))
	}

	return (
		<div className="hl-stack hl-stack--tight" style={{ gap: "0.4rem" }}>
			<select
				aria-label="Shipping method"
				className="hl-select"
				disabled={busy !== null}
				onChange={e => save({ method: isFulfillmentMethod(e.target.value) ? e.target.value : null })}
				value={method ?? ""}
			>
				<option value="">Method not chosen</option>
				{Object.entries(METHOD_LABELS).map(([value, label]) => (
					<option key={value} value={value}>
						{label}
					</option>
				))}
			</select>
			<select
				aria-label="Fulfilment stage"
				className="hl-select"
				disabled={busy !== null || cancelled}
				onChange={e => {
					if (isFulfillmentStage(e.target.value)) save({ stage: e.target.value })
				}}
				value={stage}
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
