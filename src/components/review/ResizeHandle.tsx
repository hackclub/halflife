"use client"

import { useRef, useState } from "react"

const KEY_STEP = 16

const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), Math.max(min, max))

/** A draggable, keyboard-operable divider for resizing a side panel. Fabricate's `hurt/ui/ResizeHandle`, unchanged. */
export function ResizeHandle({
	edge,
	label,
	max,
	min,
	onResize,
	width,
}: {
	edge: "start" | "end"
	label: string
	max: number
	min: number
	onResize(width: number | null): void
	width: number
}) {
	const drag = useRef<{ width: number; x: number } | null>(null)
	const [dragging, setDragging] = useState(false)
	const sign = edge === "end" ? 1 : -1
	const limit = (): number => Math.min(max, window.innerWidth * 0.6)

	return (
		// biome-ignore lint/a11y/useSemanticElements: an <hr> cannot take focus or pointer events, which a resize handle needs
		<div
			aria-label={label}
			aria-orientation="vertical"
			aria-valuemax={max}
			aria-valuemin={min}
			aria-valuenow={Math.round(width)}
			className={dragging ? "resize-handle is-dragging" : "resize-handle"}
			onDoubleClick={() => onResize(null)}
			onKeyDown={e => {
				if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
				e.preventDefault()
				const direction = e.key === "ArrowRight" ? 1 : -1
				onResize(clamp(width + sign * direction * KEY_STEP, min, limit()))
			}}
			onLostPointerCapture={() => {
				drag.current = null
				setDragging(false)
			}}
			onPointerDown={e => {
				if (e.button !== 0) return
				e.preventDefault()
				e.currentTarget.setPointerCapture(e.pointerId)
				drag.current = { width, x: e.clientX }
				setDragging(true)
			}}
			onPointerMove={e => {
				if (!drag.current) return
				onResize(clamp(drag.current.width + sign * (e.clientX - drag.current.x), min, limit()))
			}}
			role="separator"
			tabIndex={0}
			title={`${label}. Double-click to reset.`}
		/>
	)
}
