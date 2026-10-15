"use client"

import { useState } from "react"
import { IconX } from "@/components/platform/icons"
import { pauseReels, ReelCard } from "@/components/platform/reels/ReelCard"
import { useFeed } from "@/components/platform/reels/useFeed"
import { Panel } from "@/components/platform/ui"
import { cx } from "@/lib/cx"

export function DoomscrollerFeed({ onClose, className }: { onClose?: () => void; className?: string }) {
	const feed = useFeed()
	// The rail sits beside every page in the app, so it does not start talking unprompted. Once the reader has pressed play on one reel they are watching the feed, and from then on scrolling hands playback to the next reel the way the full-page Doomscroller does from the start.
	const [watching, setWatching] = useState(false)

	return (
		<Panel as="aside" className={cx("flex min-h-0 flex-col bg-cream/60 p-3.5", className)} radius={18} tone="line">
			<div className="mb-3 flex shrink-0 items-center justify-between gap-2 px-0.5">
				<h2 className="label text-navy-faint">The Doomscroller</h2>
				{onClose && (
					<button
						aria-label="Hide the Doomscroller"
						className="grid size-7 place-items-center rounded-full text-navy-faint transition-colors hover:bg-black/5 hover:text-navy"
						// Closing collapses the rail over a few hundred milliseconds, and the observer only lets go once the reel has shrunk out of view. Silencing it on the press is what makes the close feel instant.
						onClick={() => {
							pauseReels()
							onClose()
						}}
						type="button"
					>
						<IconX className="text-base" />
					</button>
				)}
			</div>
			{/* No visible scrollbar: the reels snap one at a time, so the feed reads
          as a stack of cards, and a bar down its edge only narrowed them. It
          still scrolls by wheel, trackpad and touch. */}
			<div className="no-scrollbar snap-y-feed -mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pb-1">
				{feed.items.map(r => (
					<ReelCard
						autoplay={watching}
						className="snap-item h-full min-h-[380px] shrink-0"
						key={r.id}
						onPatch={feed.patch}
						onPlayPress={() => setWatching(true)}
						reel={r}
					/>
				))}
				{feed.error && <p className="hand shrink-0 py-6 text-center text-[0.8rem] text-coral-deep">{feed.error}</p>}
				{!feed.error && feed.items.length === 0 && !feed.loading && (
					<p className="hand shrink-0 py-6 text-center text-[0.8rem] text-navy-soft">
						nothing here yet. post the first one.
					</p>
				)}
				{feed.items.length > 0 && !feed.done && (
					<button
						className="label shrink-0 rounded-full border-2 border-line py-2 text-navy-soft transition-colors hover:border-navy hover:text-navy"
						disabled={feed.loading}
						onClick={feed.more}
						type="button"
					>
						{feed.loading ? "Loading…" : "More"}
					</button>
				)}
				{feed.done && feed.items.length > 0 && (
					<p className="hand shrink-0 py-6 text-center text-[0.8rem] text-navy-soft">
						that&apos;s everything! your turn to go build something.
					</p>
				)}
			</div>
		</Panel>
	)
}
