"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

type TierOption = {
	id: number
	name: string
	grantUsd: number
	fundingHours: number
	/** Funded hours: the parts money, and the submit floor. */
	submitFloorHours: number
}

/**
 * The reviewer's decision form.
 *
 * A tier is required when approving a design, because that is where the parts money is decided. Feedback is required on anything that is not an approval.
 */
export function DecisionPanel({
	submissionId,
	phase,
	tiers,
	currentTier,
	computedHours,
	claimedByMe,
}: Readonly<{
	submissionId: string
	phase: "DESIGN" | "BUILD"
	tiers: TierOption[]
	currentTier: number | null
	computedHours: number
	claimedByMe: boolean
}>) {
	const router = useRouter()
	const [result, setResult] = useState<"APPROVED" | "RETURNED" | "REJECTED">("APPROVED")
	const [feedback, setFeedback] = useState("")
	const [reason, setReason] = useState("")
	const [tier, setTier] = useState<string>(currentTier ? String(currentTier) : "")
	const [hoursOverride, setHoursOverride] = useState("")
	const { busy, error, run } = useAction()

	const approvingDesign = result === "APPROVED" && phase === "DESIGN"

	function submit(e: React.FormEvent) {
		e.preventDefault()
		const body =
			result === "APPROVED"
				? {
						feedback,
						reason: reason || undefined,
						result,
						...(tier ? { tier: Number(tier) } : {}),
						...(hoursOverride ? { hoursOverride: Number(hoursOverride) } : {}),
					}
				: result === "RETURNED"
					? { feedback, reason: reason || undefined, result }
					: { feedback, reason, result }
		void run(
			"submit",
			() => sendJson(`/api/review/submissions/${submissionId}/decision`, { body }),
			() => {
				router.push("/review")
				router.refresh()
			},
		)
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{!claimedByMe ? (
				<Callout tone="warning">You have not claimed this. Claim it first so nobody duplicates your work.</Callout>
			) : null}

			<Field label="Decision">
				<select className="hl-select" onChange={e => setResult(e.target.value as typeof result)} value={result}>
					<option value="APPROVED">Approve</option>
					<option value="RETURNED">Send back for changes</option>
					<option value="REJECTED">Reject</option>
				</select>
			</Field>

			{approvingDesign ? (
				<Field hint="This sets the parts budget. Required when approving a design." label="Funding tier">
					<select className="hl-select" onChange={e => setTier(e.target.value)} required value={tier}>
						<option value="">Choose a tier…</option>
						{tiers.map(t => (
							<option key={t.id} value={t.id}>
								{t.name} – ${t.grantUsd} for parts, submit from {t.fundingHours}h of design time
							</option>
						))}
					</select>
				</Field>
			) : null}

			{result === "APPROVED" ? (
				<Field hint={`Leave blank to accept the computed ${computedHours}h.`} label="Hours override">
					<input
						className="hl-input"
						min="0"
						onChange={e => setHoursOverride(e.target.value)}
						placeholder={String(computedHours)}
						step="0.25"
						type="number"
						value={hoursOverride}
					/>
				</Field>
			) : null}

			<Field hint="They see this verbatim." label="Feedback to the participant">
				<textarea
					className="hl-textarea"
					maxLength={8000}
					onChange={e => setFeedback(e.target.value)}
					required={result !== "APPROVED"}
					value={feedback}
				/>
			</Field>

			<Field hint="Never shown to the participant. Feeds the grant record's justification." label="Internal note">
				<textarea
					className="hl-textarea"
					maxLength={8000}
					onChange={e => setReason(e.target.value)}
					required={result === "REJECTED"}
					value={reason}
				/>
			</Field>

			<div>
				<Button disabled={busy !== null} type="submit" variant="primary">
					{busy ? "Recording…" : "Record decision"}
				</Button>
			</div>
		</form>
	)
}
