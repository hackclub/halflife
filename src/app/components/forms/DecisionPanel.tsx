"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

interface TierOption {
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
						result,
						feedback,
						reason: reason || undefined,
						...(tier ? { tier: Number(tier) } : {}),
						...(hoursOverride ? { hoursOverride: Number(hoursOverride) } : {}),
					}
				: result === "RETURNED"
					? { result, feedback, reason: reason || undefined }
					: { result, feedback, reason }
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
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{!claimedByMe ? (
				<Callout tone="warning">You have not claimed this. Claim it first so nobody duplicates your work.</Callout>
			) : null}

			<Field label="Decision">
				<select className="hl-select" value={result} onChange={(e) => setResult(e.target.value as typeof result)}>
					<option value="APPROVED">Approve</option>
					<option value="RETURNED">Send back for changes</option>
					<option value="REJECTED">Reject</option>
				</select>
			</Field>

			{approvingDesign ? (
				<Field label="Funding tier" hint="This sets the parts budget. Required when approving a design.">
					<select className="hl-select" value={tier} required onChange={(e) => setTier(e.target.value)}>
						<option value="">Choose a tier…</option>
						{tiers.map((t) => (
							<option key={t.id} value={t.id}>
								{t.name} – ${t.grantUsd} for parts, submit from {t.fundingHours}h of design time
							</option>
						))}
					</select>
				</Field>
			) : null}

			{result === "APPROVED" ? (
				<Field label="Hours override" hint={`Leave blank to accept the computed ${computedHours}h.`}>
					<input
						className="hl-input"
						type="number"
						min="0"
						step="0.25"
						value={hoursOverride}
						placeholder={String(computedHours)}
						onChange={(e) => setHoursOverride(e.target.value)}
					/>
				</Field>
			) : null}

			<Field label="Feedback to the participant" hint="They see this verbatim.">
				<textarea
					className="hl-textarea"
					value={feedback}
					required={result !== "APPROVED"}
					maxLength={8000}
					onChange={(e) => setFeedback(e.target.value)}
				/>
			</Field>

			<Field label="Internal note" hint="Never shown to the participant. Feeds the grant record's justification.">
				<textarea
					className="hl-textarea"
					value={reason}
					required={result === "REJECTED"}
					maxLength={8000}
					onChange={(e) => setReason(e.target.value)}
				/>
			</Field>

			<div>
				<Button type="submit" variant="primary" disabled={busy !== null}>
					{busy ? "Recording…" : "Record decision"}
				</Button>
			</div>
		</form>
	)
}
