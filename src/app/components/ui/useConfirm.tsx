"use client"

import { type ReactNode, useState } from "react"
import { Button, Field, Modal, TextArea } from "@/app/components/ui"

export interface ConfirmOptions {
	/** The button that goes ahead. Defaults to "Continue". */
	confirmLabel?: string
	/** Ask for a line of text as well, such as a reason. The confirm button stays off until it is filled in. */
	input?: { label: string; placeholder?: string }
	message: string
	title: string
	/** A danger action gets the red button, so the reader sees what they are about to do. */
	tone?: "default" | "danger"
}

interface Pending {
	options: ConfirmOptions
	resolve(value: string | null): void
}

/**
 * The console's replacement for `window.confirm` and `window.prompt`. Render the returned `dialog` somewhere in the component, then `await confirm(...)`.
 *
 * The promise resolves to `null` when the reader cancels, and to the typed text (or an empty string when there is no input) when they go ahead. That keeps the caller's flow the same as the browser's: a guard at the top, and the action below it.
 */
export function useConfirm(): { dialog: ReactNode; confirm(options: ConfirmOptions): Promise<string | null> } {
	const [pending, setPending] = useState<Pending | null>(null)
	const [text, setText] = useState("")

	const confirm = (options: ConfirmOptions): Promise<string | null> => {
		const { promise, resolve } = Promise.withResolvers<string | null>()
		setText("")
		setPending({ options, resolve })
		return promise
	}

	const close = (value: string | null): void => {
		pending?.resolve(value)
		setPending(null)
	}

	const dialog = pending ? (
		<Modal onClose={() => close(null)} open title={pending.options.title}>
			<p style={{ margin: 0 }}>{pending.options.message}</p>
			{pending.options.input ? (
				<Field label={pending.options.input.label}>
					<TextArea
						onChange={event => setText(event.target.value)}
						placeholder={pending.options.input.placeholder}
						rows={3}
						value={text}
					/>
				</Field>
			) : null}
			<div className="hl-row" style={{ justifyContent: "flex-end" }}>
				<Button onClick={() => close(null)} type="button">
					Cancel
				</Button>
				<Button
					disabled={pending.options.input !== undefined && text.trim() === ""}
					onClick={() => close(pending.options.input ? text.trim() : "")}
					type="button"
					variant={pending.options.tone === "danger" ? "danger" : "primary"}
				>
					{pending.options.confirmLabel ?? "Continue"}
				</Button>
			</div>
		</Modal>
	) : null

	return { confirm, dialog }
}
