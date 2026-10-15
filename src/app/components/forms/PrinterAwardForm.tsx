"use client"
import { useState } from "react"
import { Callout } from "@/app/components/ui"
import type { PrinterAwardStatus } from "@/app/generated/prisma/enums"
import { PRINTER_AWARD_LABELS, PRINTER_AWARD_NEXT } from "@/lib/printer-award"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * One printer award's next step: lock the address, pack, ship, deliver, or revoke. The moves offered are the same ones the server enforces, so the form cannot propose a transition the API will refuse.
 */
export function PrinterAwardForm({ awardId, status }: Readonly<{ awardId: string; status: PrinterAwardStatus }>) {
	const [next, setNext] = useState<PrinterAwardStatus | "">("")
	const [trackingNumber, setTrackingNumber] = useState("")
	const [trackingCarrier, setTrackingCarrier] = useState("")
	const [note, setNote] = useState("")
	const { busy, error, run } = useAction()

	const options = PRINTER_AWARD_NEXT[status]
	if (options.length === 0) return <span className="hl-hint">final</span>

	function save() {
		if (!next) return
		const status = next
		void run(
			"save",
			() =>
				sendJson(`/api/admin/printer-awards/${awardId}`, {
					method: "PATCH",
					body: {
						status,
						...(status === "SHIPPED" || status === "DELIVERED" ? { trackingNumber, trackingCarrier } : {}),
						note,
					},
				}),
			() => {
				setNext("")
				setTrackingNumber("")
				setTrackingCarrier("")
				setNote("")
			},
		)
	}

	return (
		<form
			className="hl-stack hl-stack--tight"
			onSubmit={e => {
				e.preventDefault()
				save()
			}}
			style={{ gap: "0.4rem", minWidth: "12rem" }}
		>
			<select
				aria-label="Next printer award status"
				className="hl-select"
				disabled={busy !== null}
				onChange={e => setNext(e.target.value as PrinterAwardStatus | "")}
				value={next}
			>
				<option value="">Move to…</option>
				{options.map(value => (
					<option key={value} value={value}>
						{PRINTER_AWARD_LABELS[value]}
					</option>
				))}
			</select>
			{next === "SHIPPED" || next === "DELIVERED" ? (
				<>
					<input
						className="hl-input"
						disabled={busy !== null}
						onChange={e => setTrackingNumber(e.target.value)}
						placeholder="Tracking number"
						value={trackingNumber}
					/>
					<input
						className="hl-input"
						disabled={busy !== null}
						onChange={e => setTrackingCarrier(e.target.value)}
						placeholder="Carrier"
						value={trackingCarrier}
					/>
				</>
			) : null}
			{next ? (
				<input
					className="hl-input"
					disabled={busy !== null}
					onChange={e => setNote(e.target.value)}
					placeholder={next === "REVOKED" ? "Reason (required)" : "Note (optional)"}
					value={note}
				/>
			) : null}
			<button
				className="hl-btn"
				disabled={busy !== null || !next || (next === "REVOKED" && !note.trim())}
				type="submit"
			>
				Save
			</button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</form>
	)
}
