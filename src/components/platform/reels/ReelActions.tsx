"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import { Avatar } from "@/components/platform/Avatar"
import { IconChevronDown, IconChevronUp, IconComment, IconEye, IconHeart } from "@/components/platform/icons"
import { ReportButton } from "@/components/platform/report/ReportButton"
import { cx } from "@/lib/cx"
import type { FeedItem } from "@/lib/feed"
import { prefersStill } from "@/lib/reduced-motion"
import { compact } from "./format"
import { sendLike } from "./ReelCard"

/** The drawn round button the Doomscroller has always stepped with. */
function NavButton({
	label,
	onClick,
	disabled,
	children,
}: {
	label: string
	onClick(): void
	disabled: boolean
	children: React.ReactNode
}) {
	return (
		<button
			aria-label={label}
			className={cx(
				"sketch grid size-11 place-items-center rounded-full bg-paper transition-colors",
				disabled ? "cursor-not-allowed text-navy-faint/60" : "text-navy hover:bg-mint hover:text-teal-ink",
			)}
			disabled={disabled}
			onClick={onClick}
			style={{
				"--sk-color": disabled ? "var(--color-line)" : "var(--color-teal)",
				"--sk-radius": "999px",
			}}
			type="button"
		>
			{children}
		</button>
	)
}

/**
 * One of the reel's actions: an icon in a drawn disc, its count underneath. Pressed, the disc takes the action's own colour – coral for a like, violet for the open conversation. Over the picture on a phone the disc is dropped and the icon carries a shadow instead, so it reads on any frame without boxing off the video.
 */
function Action({
	label,
	count,
	pressed,
	tone,
	onClick,
	pop,
	popKey,
	children,
}: {
	label: string
	count: number
	pressed?: boolean
	tone?: "coral" | "violet"
	onClick?(): void
	/** Plays the acknowledgement when this turns true – a like landing. */
	pop?: boolean
	/** Which reel it belongs to, so arriving on an already-liked reel does not play it. */
	popKey?: string
	children: React.ReactNode
}) {
	const disc = useRef<HTMLSpanElement>(null)
	const seen = useRef<{ key?: string; on?: boolean }>({ key: popKey, on: pop })

	useEffect(() => {
		const prev = seen.current
		seen.current = { key: popKey, on: pop }
		if (!pop || prev.key !== popKey || prev.on) return
		if (prefersStill()) return
		disc.current?.animate(
			[
				{ transform: "scale(1)" },
				{ offset: 0.35, transform: "scale(1.28)" },
				{ offset: 0.7, transform: "scale(0.94)" },
				{ transform: "scale(1)" },
			],
			{ duration: 420, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
		)
	}, [pop, popKey])

	const on = pressed && tone
	// `field`, not `line`, at rest: it is the edge colour that clears 3:1 on the cream the disc sits on.
	const ring =
		on === "coral" ? "var(--color-coral-deep)" : on === "violet" ? "var(--color-violet-deep)" : "var(--color-field)"

	// One class per state rather than a base and an override: two utilities for the same property in the same variant are settled by stylesheet order, not by the order they are written here.
	const face =
		on === "coral"
			? "bg-coral-deep text-white md:bg-coral/15 md:text-coral-dark"
			: on === "violet"
				? "bg-violet-deep text-white md:bg-violet-pale md:text-violet-deep"
				: "bg-black/55 text-white md:bg-paper md:text-navy"

	const body = (
		<>
			<span
				className={cx(
					// The drawn outline is always there, but only inked from md: over the picture on a phone a ring would box off the video.
					"sketch grid size-11 place-items-center rounded-full transition-colors [--sk-color:transparent] md:[--sk-color:var(--ring)]",
					// Phone: over the picture, which can be any brightness – a white CAD window or a lit bench as easily as a dark one – so the icon sits on a disc of its own, as the card's mute button does. From md: a drawn paper disc beside the reel.
					"backdrop-blur-sm md:backdrop-blur-none",
					face,
					onClick && !on && "md:group-hover:bg-mint md:group-hover:text-teal-ink",
				)}
				ref={disc}
				style={{ "--ring": ring, "--sk-radius": "999px" }}
			>
				{children}
			</span>
			{/* The count is text on the same unknown picture, so it gets the same ground on a phone. */}
			<span className="label rounded-full bg-black/55 px-1.5 py-px text-white tabular-nums backdrop-blur-sm md:bg-transparent md:px-0 md:py-0 md:text-navy md:backdrop-blur-none">
				{compact(count)}
			</span>
		</>
	)

	return onClick ? (
		<button
			aria-label={label}
			aria-pressed={pressed}
			className="group flex flex-col items-center gap-1"
			onClick={onClick}
			type="button"
		>
			{body}
		</button>
	) : (
		<span aria-label={label} className="flex flex-col items-center gap-1" role="img">
			{body}
		</span>
	)
}

/**
 * The reel's controls, on the right of the stage.
 *
 * Kept over the picture on a phone, where there is no room beside it, and beside it from md. They belong to the current reel, so the whole rail is keyed off `current` rather than staying put with stale numbers.
 */
export function ReelActions({
	commentsBeside,
	current,
	index,
	last,
	onComments,
	onPatch,
	onStep,
	sheetOpen,
	viewerId,
}: {
	commentsBeside: boolean
	current: FeedItem
	index: number
	last: number
	onComments(): void
	onPatch(id: string, next: Partial<FeedItem>): void
	onStep(dir: 1 | -1): void
	sheetOpen: boolean
	viewerId: string
}) {
	return (
		<div className="absolute right-2.5 bottom-19 z-20 flex flex-col items-center md:right-auto md:bottom-17 md:left-full md:ml-5">
			{/* Only where the column is tall enough to hold them above the actions (see .doom-stage); the wheel and the keys still move the reel when it is not. */}
			<div className="doom-arrows mb-6 hidden flex-col gap-2.5 md:flex">
				<NavButton disabled={index === 0} label="Previous reel" onClick={() => onStep(-1)}>
					<IconChevronUp className="text-xl" />
				</NavButton>
				<NavButton disabled={index >= last} label="Next reel" onClick={() => onStep(1)}>
					<IconChevronDown className="text-xl" />
				</NavButton>
			</div>

			<div className="flex flex-col items-center gap-3.5">
				<Link
					aria-label={`${current.author.name ?? "A maker"}'s profile`}
					className="mb-1 rounded-full ring-2 ring-white transition-transform hover:scale-105 active:scale-95 md:ring-navy"
					href={`/u/${current.author.id}`}
				>
					<Avatar className="size-11 text-[1.05rem]" image={current.author.image} name={current.author.name} />
				</Link>

				<Action
					count={current.likeCount}
					label={current.likedByMe ? "Unlike" : "Like"}
					onClick={() => sendLike(current, !current.likedByMe, onPatch)}
					pop={current.likedByMe}
					popKey={current.id}
					pressed={current.likedByMe}
					tone="coral"
				>
					<IconHeart className="text-[1.35rem]" fill={current.likedByMe ? "currentColor" : "none"} />
				</Action>
				<Action
					count={current.commentCount}
					label={`Comments (${current.commentCount})`}
					onClick={onComments}
					pressed={commentsBeside ? true : sheetOpen}
					tone="violet"
				>
					<IconComment className="text-[1.3rem]" />
				</Action>
				<Action count={current.viewCount} label={`${current.viewCount} views`}>
					<IconEye className="text-[1.3rem]" />
				</Action>
				{current.author.id !== viewerId && (
					<ReportButton
						context={current.caption || undefined}
						target={{ id: current.id, type: "REEL" }}
						title="Report this reel"
						tone="adaptive"
					/>
				)}
			</div>
		</div>
	)
}
