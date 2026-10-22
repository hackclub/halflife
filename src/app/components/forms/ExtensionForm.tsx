"use client"
import { useEffect, useState } from "react"
import { Button, Callout } from "@/app/components/ui"
import { toLocalInput } from "@/lib/deadline"
import { sendJson, useAction } from "@/lib/use-action"

const DAY_MS = 24 * 60 * 60 * 1000

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
	// Filled in after mount: the server renders in its own timezone, and the input has to show the admin's.
	const [value, setValue] = useState("")
	useEffect(() => {
		// reading the browser's timezone
		setValue(current ? toLocalInput(new Date(current)) : "")
	}, [current])
	const { busy, error, run } = useAction()

	const active = current !== null && new Date(current) > new Date()

	function save(until: Date | null) {
		void run(
			"save",
			() => sendJson(url, { body: { submissionExtensionUntil: until?.toISOString() ?? null }, method: "PATCH" }),
			() => setValue(until ? toLocalInput(until) : ""),
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
				<input
					aria-label="Extend until"
					className="hl-input"
					onChange={e => setValue(e.target.value)}
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
