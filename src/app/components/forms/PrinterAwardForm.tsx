"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Callout } from "@/app/components/ui"
import type { PrinterAwardStatus } from "@/app/generated/prisma/enums"
import { PRINTER_AWARD_LABELS, PRINTER_AWARD_NEXT } from "@/lib/printer-award"

/**
 * One printer award's next step: lock the address, pack, ship, deliver, or revoke. The moves offered are the same ones the server enforces, so the form cannot propose a transition the API will refuse.
 */
export function PrinterAwardForm({ awardId, status }: Readonly<{ awardId: string; status: PrinterAwardStatus }>) {
	const router = useRouter()
	const [next, setNext] = useState<PrinterAwardStatus | "">("")
	const [trackingNumber, setTrackingNumber] = useState("")
	const [trackingCarrier, setTrackingCarrier] = useState("")
	const [note, setNote] = useState("")
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const options = PRINTER_AWARD_NEXT[status]
	if (options.length === 0) return <span className="hl-hint">final</span>

	async function save() {
		if (!next) return
		setBusy(true)
		setError(null)
		try {
			const res = await fetch(`/api/admin/printer-awards/${awardId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: next,
					...(next === "SHIPPED" || next === "DELIVERED" ? { trackingNumber, trackingCarrier } : {}),
					note,
				}),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Failed (${res.status})`)
				return
			}
			setNext("")
			setTrackingNumber("")
			setTrackingCarrier("")
			setNote("")
			router.refresh()
		} catch (err) {
			setError(err instanceof Error ? err.message : "Request failed")
		} finally {
			setBusy(false)
		}
	}

	return (
		<form
			className="hl-stack hl-stack--tight"
			style={{ gap: "0.4rem", minWidth: "12rem" }}
			onSubmit={(e) => {
				e.preventDefault()
				save()
			}}
		>
			<select
				className="hl-select"
				aria-label="Next printer award status"
				value={next}
				disabled={busy}
				onChange={(e) => setNext(e.target.value as PrinterAwardStatus | "")}
			>
				<option value="">Move to…</option>
				{options.map((value) => (
					<option key={value} value={value}>
						{PRINTER_AWARD_LABELS[value]}
					</option>
				))}
			</select>
			{next === "SHIPPED" || next === "DELIVERED" ? (
				<>
					<input
						className="hl-input"
						placeholder="Tracking number"
						value={trackingNumber}
						disabled={busy}
						onChange={(e) => setTrackingNumber(e.target.value)}
					/>
					<input
						className="hl-input"
						placeholder="Carrier"
						value={trackingCarrier}
						disabled={busy}
						onChange={(e) => setTrackingCarrier(e.target.value)}
					/>
				</>
			) : null}
			{next ? (
				<input
					className="hl-input"
					placeholder={next === "REVOKED" ? "Reason (required)" : "Note (optional)"}
					value={note}
					disabled={busy}
					onChange={(e) => setNote(e.target.value)}
				/>
			) : null}
			<button className="hl-btn" type="submit" disabled={busy || !next || (next === "REVOKED" && !note.trim())}>
				Save
			</button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</form>
	)
}
