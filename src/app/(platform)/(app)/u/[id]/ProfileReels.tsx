"use client"

import { useState } from "react"
import { Modal } from "@/components/platform/modals/Modal"
import { pauseReels, ReelCard } from "@/components/platform/reels/ReelCard"
import { ReelComments } from "@/components/platform/reels/ReelComments"
import type { FeedItem } from "@/lib/feed"
import { useStore } from "@/lib/store"

/**
 * The reels on a profile, as a grid of the same card the Doomscroller's rail
 * uses.
 *
 * Nothing autoplays here — a wall of clips should not all start talking at
 * once — so each card is played by hand. A like patches its row in place, the
 * way the rail does, so the count moves without a reload. Comments open in a
 * dialog over the profile rather than carrying the reader off to the
 * Doomscroller.
 */
export function ProfileReels({ initial }: { initial: FeedItem[] }) {
	const { viewer } = useStore()
	const [items, setItems] = useState(initial)
	const [commentsId, setCommentsId] = useState<string | null>(null)
	const patch = (id: string, next: Partial<FeedItem>) =>
		setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)))

	// Read live, so a comment posted in the dialog moves the card's count.
	const active = commentsId ? (items.find((r) => r.id === commentsId) ?? null) : null

	function openComments(reel: FeedItem) {
		pauseReels()
		setCommentsId(reel.id)
	}

	function closeComments() {
		setCommentsId(null)
	}

	return (
		<>
			<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{items.map((reel) => (
					<li key={reel.id} className="min-w-0">
						<ReelCard reel={reel} onPatch={patch} onComments={openComments} className="aspect-[9/16]" />
					</li>
				))}
			</ul>

			{active && (
				<Modal
					open
					onClose={closeComments}
					eyebrow={`Comments · reel by ${active.author.name ?? "a maker"}`}
					accent="var(--color-violet)"
					size="md"
				>
					<ReelComments
						reel={active}
						viewer={{ name: viewer.name, image: viewer.image }}
						onPatch={patch}
						onClose={closeComments}
						className="h-[min(70dvh,36rem)]"
					/>
				</Modal>
			)}
		</>
	)
}
