"use client"

import { type ReactNode, useEffect, useId, useRef } from "react"
import { IconX } from "./icons"

/**
 * The console's modal. It is a native `<dialog>`, so the browser supplies the focus trap, Escape handling and the top layer; the panel inside uses the same white 10px card as every other console surface.
 *
 * `open` is controlled by the caller. The dialog is only rendered when there is something to show, which keeps `autoFocus` in the form working and leaves no closed dialogs in the tree.
 */
export function Modal({
	open,
	onClose,
	title,
	children,
}: Readonly<{
	open: boolean
	onClose(): void
	title: string
	children: ReactNode
}>) {
	const ref = useRef<HTMLDialogElement>(null)
	const titleId = useId()

	useEffect(() => {
		const dialog = ref.current
		if (!dialog) return
		if (open && !dialog.open) {
			dialog.showModal()
			// The browser focuses the first focusable element, which is the close button; a form's first field is the better landing place.
			dialog.querySelector<HTMLElement>("textarea, input, select")?.focus()
		} else if (!open && dialog.open) dialog.close()
	}, [open])

	return (
		<dialog
			aria-labelledby={titleId}
			className="hl-modal"
			onCancel={event => {
				event.preventDefault()
				onClose()
			}}
			onClose={onClose}
			ref={ref}
		>
			<div className="hl-panel hl-stack hl-stack--tight">
				<div className="hl-row" style={{ justifyContent: "space-between" }}>
					<h2 id={titleId} style={{ fontSize: "1.05rem", margin: 0 }}>
						{title}
					</h2>
					<button aria-label="Close" className="hl-icon-btn" onClick={onClose} type="button">
						<IconX />
					</button>
				</div>
				{children}
			</div>
		</dialog>
	)
}
