"use client"
import { Button, Callout } from "@/app/components/ui"
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
	onDone?: () => void
	/** Ask for a reason before sending; the text is sent as `{ reason }`. */
	reasonPrompt?: string
}>) {
	const { busy, error, run } = useAction()

	function submit() {
		if (confirm && !window.confirm(confirm)) return
		let payload = body
		if (reasonPrompt) {
			const reason = window.prompt(reasonPrompt)?.trim()
			// A cancelled or empty prompt is a cancelled action, not a request the server should reject for an empty reason.
			if (!reason) return
			payload = { reason }
		}
		void run(
			"submit",
			() => sendJson(url, { body: payload, method }),
			() => onDone?.(),
		)
	}

	return (
		<span className="hl-stack hl-stack--tight">
			<Button disabled={busy !== null || disabled} onClick={submit} variant={variant}>
				{busy ? (pendingLabel ?? "Working…") : label}
			</Button>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</span>
	)
}
