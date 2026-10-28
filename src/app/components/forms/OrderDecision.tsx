"use client"
import { useState } from "react"
import { Button, Callout, Field, Select, TextInput } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

const ACTIONS = ["FULFILL", "REJECT", "HOLD"] as const
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
			<Select
				onChange={e => {
					const next = ACTIONS.find(candidate => candidate === e.target.value)
					if (next) setAction(next)
				}}
				value={action}
			>
				<option value="FULFILL">Fulfil</option>
				<option value="REJECT">Reject and refund</option>
				<option value="HOLD">Put on hold</option>
			</Select>
			{action === "FULFILL" ? (
				<>
					<Field label="Carrier">
						<TextInput onChange={e => setCarrier(e.target.value)} value={carrier} />
					</Field>
					<Field label="Tracking number">
						<TextInput onChange={e => setTracking(e.target.value)} value={tracking} />
					</Field>
				</>
			) : (
				<Field hint="Shown to the participant." label="Reason">
					<TextInput onChange={e => setReason(e.target.value)} required value={reason} />
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
