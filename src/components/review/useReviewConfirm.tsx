"use client"

import { type ReactNode, useEffect, useRef, useState } from "react"
import type { ConfirmOptions } from "@/app/components/ui/useConfirm"

interface Pending {
	options: ConfirmOptions
	resolve(value: string | null): void
}

/**
 * `useConfirm` for the review platform: the same call and the same answers, drawn with the platform's own modal styles.
 *
 * The console's `Modal` is styled by the ops stylesheet, which the review layout does not load, so on these pages it opened bare and its buttons could not be seen.
 */
export function useReviewConfirm(): { dialog: ReactNode; confirm(options: ConfirmOptions): Promise<string | null> } {
	const ref = useRef<HTMLDialogElement>(null)
	const [pending, setPending] = useState<Pending | null>(null)
	const [text, setText] = useState("")

	useEffect(() => {
		const dialog = ref.current
		if (!dialog) return
		if (pending && !dialog.open) dialog.showModal()
		else if (!pending && dialog.open) dialog.close()
	}, [pending])

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

	const options = pending?.options
	const dialog = (
		<dialog
			className="modal"
			onCancel={event => {
				event.preventDefault()
				close(null)
			}}
			ref={ref}
		>
			{options ? (
				<form
					onSubmit={event => {
						event.preventDefault()
						close(options.input ? text.trim() : "")
					}}
				>
					<h2 className="modal__title">{options.title}</h2>
					<p className="modal__body">{options.message}</p>
					{options.input ? (
						<textarea
							aria-label={options.input.label}
							autoFocus
							className="field__textarea"
							onChange={event => setText(event.target.value)}
							placeholder={options.input.placeholder}
							rows={3}
							style={{ marginTop: "var(--space-1)", width: "100%" }}
							value={text}
						/>
					) : null}
					<div className="form__actions form__actions--end">
						<button className="btn btn--ghost" onClick={() => close(null)} type="button">
							Cancel
						</button>
						<button
							className={options.tone === "danger" ? "btn btn--danger" : "btn btn--ink"}
							disabled={options.input !== undefined && text.trim() === ""}
							type="submit"
						>
							{options.confirmLabel ?? "Continue"}
						</button>
					</div>
				</form>
			) : null}
		</dialog>
	)

	return { confirm, dialog }
}
