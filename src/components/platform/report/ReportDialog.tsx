"use client"

import { useState } from "react"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { Button, borderedInputClass, Field, OptionRow } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import { REPORT_REASONS, type ReportReason, type ReportTargetInput } from "@/lib/reports"

/**
 * Report something for staff: a reason picker, an optional note, and a send.
 *
 * One shared dialog for every surface (reels, comments, projects, users, devlogs), so reporting reads the same everywhere. It changes no state – the row stays up and the queue gains a row – and says so, so nobody files a report expecting an instant takedown.
 */
export function ReportDialog({
	open,
	onClose,
	target,
	title,
	context,
}: {
	open: boolean
	onClose(): void
	target: ReportTargetInput
	/** What is being reported, e.g. "Report this reel". */
	title: string
	/** A line of the reported thing itself, so the dialog names its subject. */
	context?: string
}) {
	const [reason, setReason] = useState<ReportReason | null>(null)
	const [details, setDetails] = useState("")
	const [sending, setSending] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [done, setDone] = useState<string | null>(null)

	function close() {
		onClose()
		// Reset for the next open, after the sheet has gone.
		window.setTimeout(() => {
			setReason(null)
			setDetails("")
			setSending(false)
			setError(null)
			setDone(null)
		}, 300)
	}

	async function send() {
		if (!reason || sending) return
		setSending(true)
		setError(null)
		try {
			const res = await fetch("/api/reports", {
				body: JSON.stringify({
					reason,
					target: target.type,
					targetId: target.id,
					...(details.trim() ? { details: details.trim() } : {}),
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => null)) as {
					error?: { message?: string }
				} | null
				setError(payload?.error?.message ?? "That report did not send. Try again.")
				return
			}
			setDone("Thanks, staff will take a look.")
		} catch {
			setError("Could not reach the server. Try again.")
		} finally {
			setSending(false)
		}
	}

	return (
		<Modal accent="var(--color-coral)" onClose={close} open={open} size="md">
			{done ? (
				<>
					<ModalTitle sub="Nothing changes right away. A report puts it in front of staff, and it never takes anything down by itself.">
						Report sent
					</ModalTitle>
					<p className="hand text-[0.9rem] text-navy">{done}</p>
					<div className="mt-5 flex justify-end">
						<Button onClick={close} variant="solid">
							Done
						</Button>
					</div>
				</>
			) : (
				<>
					<ModalTitle sub="Tell staff what is wrong. Nothing is taken down by reporting alone.">{title}</ModalTitle>
					{context && (
						<blockquote className="mb-4 max-w-[62ch] rounded-xl bg-black/[.04] px-4 py-3 text-[0.86rem] leading-relaxed whitespace-pre-line [overflow-wrap:anywhere] text-navy-soft">
							{context}
						</blockquote>
					)}

					{/* biome-ignore lint/a11y/useSemanticElements: a group of choices, not a form. */}
					<div aria-label="Reason" className="grid gap-2.5" role="group">
						{REPORT_REASONS.map(r => (
							<OptionRow key={r.id} onClick={() => setReason(r.id)} selected={reason === r.id}>
								<span className="text-[0.95rem] font-bold text-navy">{r.label}</span>
							</OptionRow>
						))}
					</div>

					<div className="mt-4">
						<Field id="report-details" label="Anything to add? (optional)">
							<textarea
								className={cx(borderedInputClass, "resize-none")}
								id="report-details"
								maxLength={2000}
								onChange={e => setDetails(e.target.value)}
								placeholder="What should staff look at?"
								rows={3}
								value={details}
							/>
						</Field>
						<p className="hand mt-1.5 text-right text-[0.76rem] text-navy-soft tabular-nums">
							{details.trim().length} / 2000
						</p>
					</div>

					{error && (
						<p className="mt-2 text-[0.85rem] font-semibold text-coral-deep" role="alert">
							{error}
						</p>
					)}

					<div className="mt-4 flex flex-wrap justify-end gap-2">
						<Button disabled={sending} onClick={close} variant="ghost">
							Cancel
						</Button>
						<Button disabled={!reason || sending} onClick={() => send()} variant="solid">
							{sending ? "Sending…" : "Send report"}
						</Button>
					</div>
				</>
			)}
		</Modal>
	)
}
