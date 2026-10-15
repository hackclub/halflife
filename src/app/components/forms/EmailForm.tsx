"use client"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * Change the address on a user's row.
 *
 * For someone who asked Hack Club to delete their identity: HCA holds the address the account was made with, the person no longer receives mail there, and every notification this platform sends goes to that stored address. Staff put the one they can read in here instead.
 *
 * The typed value is only ever a suggestion - the server refuses an address another user already holds under any capitalisation, so a mistyped duplicate comes back as a sentence rather than a constraint error.
 */
export function EmailForm({
	url,
	current,
}: Readonly<{
	/** The PATCH endpoint that takes `{ email }`. */
	url: string
	/** The address on the row right now. */
	current: string
}>) {
	const [value, setValue] = useState("")
	const { busy, error, run } = useAction()

	const trimmed = value.trim()
	// An unchanged submit is a no-op the server would refuse anyway, so it is never offered.
	const canSave = trimmed.length > 0 && trimmed.toLowerCase() !== current.toLowerCase()

	function submit(e: React.FormEvent) {
		e.preventDefault()
		if (!canSave) return
		// This is an identity change with no undo and no second copy of the old address anywhere but the audit log, so it is confirmed rather than fired off with a stray click.
		if (!window.confirm(`Change ${current} to ${trimmed}? Notifications go to the new address from now on.`)) return
		void run(
			"save",
			() => sendJson(url, { body: { email: trimmed }, method: "PATCH" }),
			() => setValue(""),
		)
	}

	return (
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			<p className="hl-hint" style={{ margin: 0 }}>
				Currently <span className="hl-mono">{current}</span>. Hack Club is the usual source of this address, and it
				overwrites whatever is stored here the next time they sign in - so this is for people who have asked HCA to
				delete their account and no longer receive mail there.
			</p>
			<Field
				hint="Their own address, not a forwarding one. Stored exactly as typed, and checked against every other user regardless of capitalisation."
				label="New email"
			>
				<input
					className="hl-input"
					maxLength={320}
					onChange={e => setValue(e.target.value)}
					placeholder="participant@example.com"
					style={{ maxWidth: "24rem" }}
					type="email"
					value={value}
				/>
			</Field>
			<div>
				<Button disabled={busy !== null || !canSave} type="submit" variant="danger">
					{busy ? "Saving…" : "Change email"}
				</Button>
			</div>
			{error ? <Callout tone="danger">{error}</Callout> : null}
		</form>
	)
}
