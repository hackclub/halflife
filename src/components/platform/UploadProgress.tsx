"use client"

import { cx } from "@/components/platform/ui"

/**
 * How far a file has got on its way up.
 *
 * Two states, because an upload has two waits. While bytes are leaving, the bar is the real fraction sent – it moves because the file is moving, never on a timer. Once the last byte has gone the server is still storing it, and that wait has no size, so the full bar carries a stripe drifting across it instead: still working, not stuck at 100%.
 *
 * The fill eases only a little (150ms), so it tracks the network rather than trailing it. With reduced motion the stripe holds still; the label says "storing" either way.
 */
export function UploadProgress({
	progress,
	name,
	className,
}: {
	/** 0 to 1. Null before the first byte is reported. */
	progress: number | null
	/** The file, when there is room to say which one. */
	name?: string
	className?: string
}) {
	const sent = progress ?? 0
	const storing = sent >= 1
	const pct = Math.round(sent * 100)

	return (
		<div className={cx("grid gap-1", className)}>
			<div className="flex items-baseline justify-between gap-3 text-[0.78rem]">
				{name && <span className="min-w-0 truncate font-semibold text-navy">{name}</span>}
				<span className="hand ml-auto shrink-0 text-navy-soft tabular-nums" aria-hidden="true">
					{storing ? "storing…" : `${pct}%`}
				</span>
			</div>
			<div
				role="progressbar"
				aria-label={name ? `Uploading ${name}` : "Uploading"}
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={storing ? undefined : pct}
				aria-valuetext={storing ? "Sent, storing the file" : `${pct}% sent`}
				className="relative h-2 overflow-hidden rounded-full bg-mint"
			>
				<div
					className="h-full rounded-full bg-teal transition-[width] duration-150 ease-out"
					style={{ width: `${Math.max(pct, progress === null ? 0 : 3)}%` }}
				/>
				{storing && <div aria-hidden="true" className="upload-storing absolute inset-0 rounded-full" />}
			</div>
		</div>
	)
}
