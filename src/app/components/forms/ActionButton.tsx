"use client"
import { useState } from "react"
import { Button, Callout, Field, Modal, TextArea } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * One button that POSTs a JSON body and refreshes the server components on the page. Client components here own interaction only – the data on screen came from the server, so a refresh is the whole update path.
 */
export function ActionButton({
	url,
	method = "POST",
	body,
	label,
	pendingLabel,
	variant = "default",
	confirm,
	disabled,
	onDone,
	reasonPrompt,
}: Readonly<{
	url: string
	method?: "POST" | "PATCH" | "DELETE"
	body?: unknown
	label: string
	pendingLabel?: string
	variant?: "default" | "primary" | "danger"
	confirm?: string
	disabled?: boolean
	onDone?(): void
	/** Ask for a reason before sending; the text is sent as `{ reason }`. */
	reasonPrompt?: string
}>) {
	const { busy, error, run } = useAction()
	const [asking, setAsking] = useState(false)
	const [reason, setReason] = useState("")

	function send(payload: unknown) {
		void run(
			"submit",
			() => sendJson(url, { body: payload, method }),
			() => onDone?.(),
		)
	}

	function submit() {
		if (confirm && !window.confirm(confirm)) return
		if (reasonPrompt) {
			setReason("")
			setAsking(true)
			return
		}
		send(body)
	}

	function sendReason() {
		const trimmed = reason.trim()
		// A cancelled or empty modal is a cancelled action, not a request the server should reject for an empty reason.
		if (!trimmed) return
		setAsking(false)
		send({ reason: trimmed })
	}

	return (
		<span className="hl-stack hl-stack--tight">
			<Button disabled={busy !== null || disabled} onClick={submit} variant={variant}>
				{busy ? (pendingLabel ?? "Working…") : label}
			</Button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{asking && reasonPrompt ? (
				<Modal onClose={() => setAsking(false)} open title={reasonPrompt}>
					<Field label="Reason">
						<TextArea onChange={e => setReason(e.target.value)} rows={4} value={reason} />
					</Field>
					<div className="hl-row" style={{ justifyContent: "flex-end" }}>
						<Button onClick={() => setAsking(false)} type="button">
							Cancel
						</Button>
						<Button disabled={busy !== null || !reason.trim()} onClick={sendReason} type="button" variant="primary">
							Send
						</Button>
					</div>
				</Modal>
			) : null}
		</span>
	)
}
