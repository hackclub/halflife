"use client"
import { useState } from "react"
import { Button, Callout, TextInput } from "@/app/components/ui"
import { useBrowserValue } from "@/lib/browser-state"
import { toLocalInput } from "@/lib/deadline"
import { DAY_MS } from "@/lib/time"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * Grant, move or clear an extension.
 *
 * An extension reopens passed weeks for journal entries and lets the work be submitted past a global close. The quick buttons count from whichever is later, now or the current extension, so pressing "+1 day" twice gives two.
 */
export function ExtensionForm({
	url,
	current,
}: Readonly<{
	/** The PATCH endpoint that takes `{ submissionExtensionUntil }`. */
	url: string
	/** ISO string of the extension now on record, if any. */
	current: string | null
}>) {
	// The input shows the admin's own timezone, which only the browser knows, so it is blank on the server and filled in from the first client render. Typing overrides it, and the override holds only until the extension on record changes.
	const formatted = useBrowserValue(() => (current ? toLocalInput(new Date(current)) : ""), "")
	const [typed, setTyped] = useState<{ base: string | null; value: string } | null>(null)
	const value = typed?.base === current ? typed.value : formatted
	const { busy, error, run } = useAction()

	const active = current !== null && new Date(current) > new Date()

	function save(until: Date | null) {
		void run(
			"save",
			() => sendJson(url, { body: { submissionExtensionUntil: until?.toISOString() ?? null }, method: "PATCH" }),
			() => setTyped({ base: current, value: until ? toLocalInput(until) : "" }),
		)
	}

	function extendBy(days: number) {
		const base = active && current ? new Date(current).getTime() : Date.now()
		save(new Date(base + days * DAY_MS))
	}

	return (
		<div className="hl-stack hl-stack--tight">
			<p className="hl-hint" style={{ margin: 0 }} suppressHydrationWarning>
				{active && current
					? `Extended until ${new Date(current).toLocaleString()}`
					: current
						? `Expired ${new Date(current).toLocaleString()}`
						: "No extension"}
			</p>
			<form
				className="hl-row"
				onSubmit={e => {
					e.preventDefault()
					if (value) save(new Date(value))
				}}
			>
				<TextInput
					aria-label="Extend until"
					onChange={e => setTyped({ base: current, value: e.target.value })}
					style={{ maxWidth: "14rem" }}
					type="datetime-local"
					value={value}
				/>
				<Button disabled={busy !== null || !value} type="submit">
					Set
				</Button>
				<Button disabled={busy !== null} onClick={() => extendBy(1)} type="button">
					+1 day
				</Button>
				<Button disabled={busy !== null} onClick={() => extendBy(3)} type="button">
					+3 days
				</Button>
				{current ? (
					<Button disabled={busy !== null} onClick={() => save(null)} type="button" variant="danger">
						Clear
					</Button>
				) : null}
			</form>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</div>
	)
}
