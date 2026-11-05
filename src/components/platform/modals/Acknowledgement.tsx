"use client"

import type { ReactNode } from "react"
import { IconCheck } from "@/components/platform/icons"
import { cx } from "@/lib/cx"

/**
 * One box a maker has to tick before a consequential action. Styled like the sheet's other confirmations, so a tick reads the same wherever it appears.
 */
export function Acknowledgement({
	checked,
	children,
	onChange,
}: {
	checked: boolean
	children: ReactNode
	onChange(checked: boolean): void
}) {
	return (
		<label
			className={cx(
				"flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
				checked ? "bg-violet-pale" : "hover:bg-black/[.03]",
			)}
		>
			<input checked={checked} className="sr-only" onChange={event => onChange(event.target.checked)} type="checkbox" />
			<span
				aria-hidden="true"
				className={cx(
					"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
					checked ? "border-transparent bg-violet" : "border-line-strong",
				)}
			>
				{checked && <IconCheck className="text-sm text-white" />}
			</span>
			<span className="min-w-0 text-[0.88rem] leading-snug text-navy">{children}</span>
		</label>
	)
}
