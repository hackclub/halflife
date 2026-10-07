"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"

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
	const router = useRouter()
	const [grantUrl, setGrantUrl] = useState("")
	const [busy, setBusy] = useState(false)
	const [message, setMessage] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	if (alreadySent) return <span className="hl-hint">grant sent</span>

	async function send() {
		if (!window.confirm(`Send $${amountUsd} to this maker's HCB card grant?`)) return
		setBusy(true)
		setError(null)
		setMessage(null)
		try {
			const res = await fetch(`/api/admin/theme-projects/${projectId}/grant`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ phase: "DESIGN", grantUrl }),
			})
			const payload = (await res.json().catch(() => null)) as {
				error?: { message?: string }
				alreadySent?: boolean
			} | null
			if (!res.ok) {
				setError(payload?.error?.message ?? `Failed (${res.status})`)
				return
			}
			setMessage(payload?.alreadySent ? "already sent" : "sent")
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(false)
		}
	}

	return (
		<span className="hl-stack hl-stack--tight">
			<input
				className="hl-input"
				placeholder="hcb.hackclub.com/grants/…"
				value={grantUrl}
				onChange={(e) => setGrantUrl(e.target.value)}
				disabled={busy}
				aria-label="HCB grant link"
			/>
			<Button variant="primary" disabled={busy || !grantUrl.trim()} onClick={() => send()}>
				{busy ? "Sending…" : `Send $${amountUsd}`}
			</Button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{message ? <span className="hl-hint">{message}</span> : null}
		</span>
	)
}
