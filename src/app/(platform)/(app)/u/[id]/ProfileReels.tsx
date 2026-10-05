"use client"

import { useState } from "react"
import { ReelCard } from "@/components/platform/reels/ReelCard"
import type { FeedItem } from "@/lib/feed"

/**
 * The reels on a profile, as a grid of the same card the Doomscroller's rail
 * uses.
 *
 * Nothing autoplays here — a wall of clips should not all start talking at
 * once — so each card is played by hand. A like patches its row in place, the
 * way the rail does, so the count moves without a reload.
 */
export function ProfileReels({ initial }: { initial: FeedItem[] }) {
	const [items, setItems] = useState(initial)
	const patch = (id: string, next: Partial<FeedItem>) =>
		setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...next } : r)))

	return (
		<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{items.map((reel) => (
				<li key={reel.id} className="min-w-0">
					<ReelCard reel={reel} onPatch={patch} className="aspect-[9/16]" />
				</li>
			))}
		</ul>
	)
}
