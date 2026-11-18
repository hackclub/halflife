"use client"

import { type ReactNode, useState } from "react"
import { Button, borderedInputClass } from "@/components/platform/ui"
import { Modal, ModalTitle } from "./Modal"

export interface ConfirmOptions {
	/** The button that goes ahead. Defaults to "Continue". */
	confirmLabel?: string
	/** Ask for a line of text as well. The confirm button stays off until it is filled in. */
	input?: { label: string; placeholder?: string }
	message: string
	title: string
	/** A destructive or irreversible action gets the coral button. */
	tone?: "default" | "danger"
}

interface Pending {
	options: ConfirmOptions
	resolve(value: string | null): void
}

/**
 * The participant side's replacement for `window.confirm` and `window.prompt`, drawn in the platform's own modal. Render the returned `dialog`, then `await confirm(...)`.
 *
 * The promise resolves to `null` when the reader cancels, and to the typed text (or an empty string when there is no input) when they go ahead, matching the console's version.
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
		<Modal footer={null} onClose={() => close(null)} open size="md">
			<ModalTitle>{pending.options.title}</ModalTitle>
			<p style={{ margin: 0 }}>{pending.options.message}</p>
			{pending.options.input ? (
				<label style={{ display: "block", marginTop: "1rem" }}>
					<span style={{ display: "block", fontWeight: 600, marginBottom: "0.35rem" }}>
						{pending.options.input.label}
					</span>
					<textarea
						className={borderedInputClass}
						onChange={event => setText(event.target.value)}
						placeholder={pending.options.input.placeholder}
						rows={3}
						value={text}
					/>
				</label>
			) : null}
			<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.25rem" }}>
				<Button onClick={() => close(null)} type="button" variant="outline">
					Cancel
				</Button>
				<Button
					disabled={pending.options.input !== undefined && text.trim() === ""}
					onClick={() => close(pending.options.input ? text.trim() : "")}
					type="button"
					variant={pending.options.tone === "danger" ? "coral" : "solid"}
				>
					{pending.options.confirmLabel ?? "Continue"}
				</Button>
			</div>
		</Modal>
	) : null

	return { confirm, dialog }
}
