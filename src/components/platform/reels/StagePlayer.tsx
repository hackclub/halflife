"use client"

import { IconPause, IconPlay, IconVolume, IconVolumeOff } from "@/components/platform/icons"
import { cx } from "@/lib/cx"
import { clock } from "./format"
import type { SlidePlayer } from "./useSlidePlayer"

/** A small drawn round button, the player strip's one control shape. */
function RoundControl({
	label,
	onClick,
	disabled,
	pressed,
	children,
}: {
	label: string
	onClick(): void
	disabled?: boolean
	pressed?: boolean
	children: React.ReactNode
}) {
	return (
		<button
			aria-label={label}
			aria-pressed={pressed}
			className="sketch grid size-9 place-items-center rounded-full bg-paper text-navy transition-colors hover:bg-mint hover:text-teal-ink disabled:cursor-not-allowed disabled:text-navy-faint"
			disabled={disabled}
			onClick={onClick}
			style={{ "--sk-color": "var(--color-line-strong)", "--sk-radius": "999px" }}
			type="button"
		>
			{children}
		</button>
	)
}

/**
 * The strip under the reel, sized by the reel column rather than the window: as the column narrows, auto-scroll goes first and speed second; play, the clock and the sound always stay.
 */
export function StagePlayer({
	autoScroll,
	hasVideo,
	muted,
	onCycleRate,
	onToggleAutoScroll,
	onToggleMute,
	player,
	rate,
}: {
	autoScroll: boolean
	hasVideo: boolean
	muted: boolean
	onCycleRate(): void
	onToggleAutoScroll(): void
	onToggleMute(): void
	player: SlidePlayer
	rate: number
}) {
	const { playing, time, toggle } = player
	return (
		<div className="@container mt-2.5 hidden h-10 shrink-0 items-center gap-2.5 text-navy md:flex">
			<RoundControl disabled={!hasVideo} label={playing ? "Pause" : "Play"} onClick={toggle}>
				{playing ? <IconPause className="text-[1rem]" /> : <IconPlay className="ml-0.5 text-[1.05rem]" />}
			</RoundControl>
			<p className="hand text-[0.8rem] text-navy-soft tabular-nums">
				{clock(time.now)} / {clock(time.total)}
			</p>

			<div className="ml-auto flex items-center gap-2">
				<button
					aria-checked={autoScroll}
					className="hidden items-center gap-2 rounded-full py-1 pr-1 pl-1.5 transition-colors hover:bg-black/5 @xs:flex"
					onClick={onToggleAutoScroll}
					role="switch"
					title="Move on to the next reel when this one ends"
					type="button"
				>
					<span className="label text-navy-soft">Auto</span>
					<span
						aria-hidden="true"
						className={cx(
							"relative h-5 w-9 rounded-full border-2 transition-colors duration-200",
							autoScroll ? "border-teal-deep bg-teal" : "border-line-strong bg-paper",
						)}
					>
						<span
							className={cx(
								"absolute top-px left-px size-3.5 rounded-full transition-[transform,background-color] duration-200 ease-[cubic-bezier(.16,1,.3,1)]",
								autoScroll ? "translate-x-4 bg-white" : "bg-line-strong",
							)}
						/>
					</span>
				</button>
				<button
					aria-label={`Playback speed ${rate} times. Change speed.`}
					className="label hidden min-w-12 rounded-full bg-black/5 px-2.5 py-1.5 text-navy-soft tabular-nums transition-colors hover:bg-sky-pale hover:text-sky-ink @2xs:inline-block"
					onClick={onCycleRate}
					type="button"
				>
					{rate.toFixed(1)}x
				</button>
				<RoundControl label={muted ? "Turn sound on" : "Mute"} onClick={onToggleMute} pressed={muted}>
					{muted ? <IconVolumeOff className="text-[1.1rem]" /> : <IconVolume className="text-[1.1rem]" />}
				</RoundControl>
			</div>
		</div>
	)
}
