"use client"

import { useState } from "react"
import { z } from "zod"
import { Button, Callout, TextInput } from "@/app/components/ui"
import { sendJsonParsed, useAction } from "@/lib/use-action"

/** What `/grant` answers once it has sent the design's grant, or found one already sent. */
const GrantBody = z.object({ alreadySent: z.boolean().optional() })

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
				sendJsonParsed(GrantBody, `/api/admin/theme-projects/${projectId}/grant`, {
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
			<TextInput
				aria-label="HCB grant link"
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
