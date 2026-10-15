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
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			<Field hint="Negative to claw back." label="Amount">
				<input className="hl-input" onChange={e => setAmount(e.target.value)} required type="number" value={amount} />
			</Field>
			<Field hint="Recorded in the ledger and the audit log." label="Reason">
				<input
					className="hl-input"
					maxLength={1000}
					onChange={e => setReason(e.target.value)}
					required
					value={reason}
				/>
			</Field>
			<div>
				<Button disabled={busy !== null || !amount || !reason} type="submit">
					{busy ? "Applying…" : "Apply adjustment"}
				</Button>
			</div>
		</form>
	)
}
