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

	function submit(e: React.SubmitEvent) {
		e.preventDefault()
		const body =
			action === "FULFILL"
				? { action, trackingCarrier: carrier || undefined, trackingNumber: tracking || undefined }
				: { action, reason }
		void run("submit", () => sendJson(`/api/admin/shop/orders/${orderId}/decision`, { body }))
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{/* oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the compiler cannot verify without a runtime check */}
			<select className="hl-select" onChange={e => setAction(e.target.value as typeof action)} value={action}>
				<option value="FULFILL">Fulfil</option>
				<option value="REJECT">Reject and refund</option>
				<option value="HOLD">Put on hold</option>
			</select>
			{action === "FULFILL" ? (
				<>
					<Field label="Carrier">
						<input className="hl-input" onChange={e => setCarrier(e.target.value)} value={carrier} />
					</Field>
					<Field label="Tracking number">
						<input className="hl-input" onChange={e => setTracking(e.target.value)} value={tracking} />
					</Field>
				</>
			) : (
				<Field hint="Shown to the participant." label="Reason">
					<input className="hl-input" onChange={e => setReason(e.target.value)} required value={reason} />
				</Field>
			)}
			<div>
				<Button disabled={busy !== null} type="submit">
					{busy ? "Working…" : "Apply"}
				</Button>
			</div>
		</form>
	)
}
