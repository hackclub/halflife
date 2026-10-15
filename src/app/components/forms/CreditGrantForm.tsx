"use client"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

export function CreditGrantForm({ userId }: Readonly<{ userId: string }>) {
	const [amount, setAmount] = useState("")
	const [reason, setReason] = useState("")
	const { busy, error, run } = useAction()

	function submit(e: React.FormEvent) {
		e.preventDefault()
		void run(
			"submit",
			() => sendJson("/api/admin/credits", { body: { userId, amount: Number(amount), reason } }),
			() => {
				setAmount("")
				setReason("")
			},
		)
	}

	return (
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<Field label="Amount" hint="Negative to claw back.">
				<input className="hl-input" type="number" value={amount} required onChange={e => setAmount(e.target.value)} />
			</Field>
			<Field label="Reason" hint="Recorded in the ledger and the audit log.">
				<input
					className="hl-input"
					value={reason}
					required
					maxLength={1000}
					onChange={e => setReason(e.target.value)}
				/>
			</Field>
			<div>
				<Button type="submit" disabled={busy !== null || !amount || !reason}>
					{busy ? "Applying…" : "Apply adjustment"}
				</Button>
			</div>
		</form>
	)
}
