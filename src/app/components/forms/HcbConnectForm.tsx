"use client"

import { useState } from "react"
import { z } from "zod"
import { Button, Callout } from "@/app/components/ui"
import { sendJsonParsed, useAction } from "@/lib/use-action"

const ConnectResult = z.object({
	needsConfirmation: z.boolean().optional(),
	url: z.string().optional(),
})

/**
 * Starts HCB's authorisation from an admin-only POST.
 *
 * Opening the HCB authorise link by hand no longer completes anything: the callback needs the state and PKCE
 * verifier this action puts in the browser's cookies, so the connection always begins and ends in one browser.
 */
export function HcbConnectForm({ connected }: Readonly<{ connected: boolean }>) {
	const { busy, error, run } = useAction()
	const [needsConfirmation, setNeedsConfirmation] = useState(false)

	function connect(confirm: boolean) {
		void run("connect", async () => {
			const result = await sendJsonParsed(ConnectResult, "/api/admin/hcb/connect", { body: { confirm } })
			if (!result.ok) return result
			if (result.data.url) {
				window.location.assign(result.data.url)
				return { data: result.data, ok: true }
			}
			setNeedsConfirmation(result.data.needsConfirmation === true)
			return { data: result.data, ok: true }
		})
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{needsConfirmation ? (
				<Callout tone="warning">
					HCB is already connected. Connecting again replaces the deployment&apos;s stored credential, and the old one
					stops working immediately.
				</Callout>
			) : null}
			<div className="hl-row" style={{ alignItems: "center", flexWrap: "wrap" }}>
				{needsConfirmation ? (
					<>
						<Button disabled={busy !== null} onClick={() => connect(true)} variant="primary">
							{busy === "connect" ? "Starting…" : "Replace the stored credential"}
						</Button>
						<Button onClick={() => setNeedsConfirmation(false)} type="button">
							Cancel
						</Button>
					</>
				) : (
					<Button
						disabled={busy !== null}
						onClick={() => connect(connected)}
						variant={connected ? "default" : "primary"}
					>
						{busy === "connect" ? "Starting…" : connected ? "Reconnect HCB" : "Connect HCB"}
					</Button>
				)}
				<span className="hl-hint">
					{connected
						? "A credential is stored. Reconnecting replaces it."
						: "Sign in to HCB as an organiser of the paying org when it asks."}
				</span>
			</div>
		</div>
	)
}
