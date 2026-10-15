"use client"

import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * Send a design's parts grant to a maker's HCB card grant.
 *
 * The grant link is pasted each time rather than stored on the row: Half Life does not own the participant's HCB grant, and a hashid kept here would go stale the moment they made a new one.
 */
export function GrantForm({
	projectId,
	amountUsd,
	alreadySent,
}: Readonly<{ projectId: string; amountUsd: number; alreadySent: boolean }>) {
	const [grantUrl, setGrantUrl] = useState("")
	const [message, setMessage] = useState<string | null>(null)
	const { busy, error, run } = useAction()

	if (alreadySent) return <span className="hl-hint">grant sent</span>

	function send() {
		if (!window.confirm(`Send $${amountUsd} to this maker's HCB card grant?`)) return
		void run(
			"send",
			() =>
				sendJson<{ alreadySent?: boolean }>(`/api/admin/theme-projects/${projectId}/grant`, {
					body: { grantUrl, phase: "DESIGN" },
				}),
			data => {
				setMessage(data.alreadySent ? "already sent" : "sent")
				setGrantUrl("")
			},
		)
	}

	return (
		<span className="hl-stack hl-stack--tight">
			<input
				aria-label="HCB grant link"
				className="hl-input"
				disabled={busy !== null}
				onChange={e => setGrantUrl(e.target.value)}
				placeholder="hcb.hackclub.com/grants/…"
				value={grantUrl}
			/>
			<Button disabled={busy !== null || !grantUrl.trim()} onClick={send} variant="primary">
				{busy ? "Sending…" : `Send $${amountUsd}`}
			</Button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{message ? <span className="hl-hint">{message}</span> : null}
		</span>
	)
}
