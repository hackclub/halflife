"use client"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

export function CreditGrantForm({ canGrant, userId }: Readonly<{ canGrant: boolean; userId: string }>) {
	const [amount, setAmount] = useState("")
	const [reason, setReason] = useState("")
	const { busy, error, run } = useAction()

	// A clawback is not a reward, so it stays available for an unverified maker; only issuing coins is locked. The route enforces the same rule.
	const blocked = Number(amount) > 0 && !canGrant

	function submit(e: React.SubmitEvent) {
		e.preventDefault()
		void run(
			"submit",
			() => sendJson("/api/admin/credits", { body: { amount: Number(amount), reason, userId } }),
			() => {
				setAmount("")
				setReason("")
			},
		)
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{canGrant ? null : (
				<Callout tone="warning">
					This maker is not identity verified, so coins cannot be granted. Negative adjustments still work.
				</Callout>
			)}
			<Field
				hint={canGrant ? "Negative to claw back." : "Only negative adjustments (clawbacks) until identity is verified."}
				label="Amount"
			>
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
				<Button disabled={busy !== null || !amount || !reason || blocked} type="submit">
					{busy ? "Applying…" : "Apply adjustment"}
				</Button>
			</div>
		</form>
	)
}
