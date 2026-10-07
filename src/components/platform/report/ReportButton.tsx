"use client"

import { useState } from "react"
import { cx } from "@/components/platform/ui"
import type { ReportTargetInput } from "@/lib/reports"
import { ReportDialog } from "./ReportDialog"

/**
 * The "report" affordance, shared by every surface: a quiet dashed button
 * that opens the report dialog for its target. Owns its own open state, so
 * hosts — server or client components alike — drop it in with two props.
 */
export function ReportButton({
	target,
	title,
	context,
	className,
	tone = "muted",
}: {
	target: ReportTargetInput
	/** What is being reported, e.g. "Report this reel". */
	title: string
	/** A line of the reported thing itself, shown in the dialog. */
	context?: string
	className?: string
	/**
	 * muted: navy on light grounds. inverse: white with a shadow, for over a
	 * video. adaptive: inverse on a phone, muted from md — for the
	 * Doomscroller's action rail, which sits over the picture on a phone and
	 * beside the reel on cream from md.
	 */
	tone?: "muted" | "inverse" | "adaptive"
}) {
	const [open, setOpen] = useState(false)

	return (
		<>
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label={title}
				className={cx(
					"hand text-[0.78rem] underline decoration-dashed underline-offset-4 transition-colors",
					tone === "muted" && "text-navy-soft hover:text-coral-deep",
					tone === "inverse" &&
						"text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,.6)] hover:text-white",
					tone === "adaptive" &&
						"text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,.6)] hover:text-white md:text-navy-soft md:[text-shadow:none] md:hover:text-coral-deep",
					className,
				)}
			>
				report
			</button>
			{open && <ReportDialog open onClose={() => setOpen(false)} target={target} title={title} context={context} />}
		</>
	)
}
