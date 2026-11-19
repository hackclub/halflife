"use client"

import { useState } from "react"
import { z } from "zod"
import { Button, Callout, TextInput } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
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

	// The hook sits above the early return, since hooks must run in the same order on every render.
	const { confirm, dialog } = useConfirm()

	if (alreadySent) return <span className="hl-hint">grant sent</span>

	async function send() {
		if (
			(await confirm({
				confirmLabel: "Send grant",
				message: "This sends the grant to the maker's HCB card.",
				title: `Send $${amountUsd}?`,
				tone: "danger",
			})) === null
		)
			return
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
			{dialog}
			<TextInput
				aria-label="HCB grant link"
				disabled={busy !== null}
				onChange={e => setGrantUrl(e.target.value)}
				placeholder="hcb.hackclub.com/grants/…"
				value={grantUrl}
			/>
			<Button disabled={busy !== null || !grantUrl.trim()} onClick={() => void send()} variant="primary">
				{busy ? "Sending…" : `Send $${amountUsd}`}
			</Button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{message ? <span className="hl-hint">{message}</span> : null}
		</span>
	)
}
