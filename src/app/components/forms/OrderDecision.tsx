"use client"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

export function OrderDecision({ orderId }: Readonly<{ orderId: string }>) {
	const [action, setAction] = useState<"FULFILL" | "REJECT" | "HOLD">("FULFILL")
	const [tracking, setTracking] = useState("")
	const [carrier, setCarrier] = useState("")
	const [reason, setReason] = useState("")
	const { busy, error, run } = useAction()

	function submit(e: React.FormEvent) {
		e.preventDefault()
		const body =
			action === "FULFILL"
				? { action, trackingNumber: tracking || undefined, trackingCarrier: carrier || undefined }
				: { action, reason }
		void run("submit", () => sendJson(`/api/admin/shop/orders/${orderId}/decision`, { body }))
	}

	return (
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<select className="hl-select" value={action} onChange={e => setAction(e.target.value as typeof action)}>
				<option value="FULFILL">Fulfil</option>
				<option value="REJECT">Reject and refund</option>
				<option value="HOLD">Put on hold</option>
			</select>
			{action === "FULFILL" ? (
				<>
					<Field label="Carrier">
						<input className="hl-input" value={carrier} onChange={e => setCarrier(e.target.value)} />
					</Field>
					<Field label="Tracking number">
						<input className="hl-input" value={tracking} onChange={e => setTracking(e.target.value)} />
					</Field>
				</>
			) : (
				<Field label="Reason" hint="Shown to the participant.">
					<input className="hl-input" value={reason} required onChange={e => setReason(e.target.value)} />
				</Field>
			)}
			<div>
				<Button type="submit" disabled={busy !== null}>
					{busy ? "Working…" : "Apply"}
				</Button>
			</div>
		</form>
	)
}
