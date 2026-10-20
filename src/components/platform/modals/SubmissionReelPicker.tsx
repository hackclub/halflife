"use client"

import { useEffect, useState } from "react"
import { IconCheck, IconFilm } from "@/components/platform/icons"
import { cx } from "@/lib/cx"

/** One closing reel the maker already posted for this hand-in. */
export interface SubmissionReel {
	caption: string
	createdAt: string
	durationSeconds: number | null
	id: string
	objectKey: string
	thumbnailUrl: string | null
	videoUrl: string | null
}

/**
 * The reels a maker has already closed this week with, offered back when they hand it in again.
 *
 * A phase sent back for changes is resubmitted from the same submit sheet, and that sheet insists on a closing reel because the first hand-in did. Making them film a second walkthrough of the same work is busywork, so the reels they have already posted for this exact checkpoint are listed here to pick from. Choosing one sets it as the closing reel without posting anything: the post the reviewer would open is the one that is already up.
 *
 * Only this week's submission reels, keyed by the checkpoint: a reel is evidence of the work it was filmed against, so another week's video is not a stand-in for this one. The list is empty until there is something to reuse, and the component renders nothing then, leaving the ordinary record-and-upload flow untouched.
 */
export function SubmissionReelPicker({
	checkpointKey,
	selectedId,
	onSelect,
}: {
	/** The submission checkpoint this hand-in posts its closing reel under, e.g. `w3-reel-submission`. */
	checkpointKey: string
	/** The already-posted reel currently standing in, if any. */
	selectedId: string | null
	/** Picks a reel, or clears the pick when handed null. */
	onSelect(reel: SubmissionReel | null): void
}) {
	const [reels, setReels] = useState<SubmissionReel[] | null>(null)

	useEffect(() => {
		let live = true
		fetch(`/api/me/reels?checkpointKey=${encodeURIComponent(checkpointKey)}`, { cache: "no-store" })
			.then(async res => {
				const body = (await res.json().catch(() => null)) as {
					error?: { message?: string }
					reels: SubmissionReel[]
				} | null
				if (!res.ok) throw new Error(body?.error?.message ?? "Could not load your previous reels")
				if (!body) throw new Error("Could not load your previous reels")
				return body
			})
			.then(body => {
				if (live) setReels(body.reels)
			})
			.catch(() => {
				// Nothing to offer if the list will not load: the maker records a fresh reel as before rather than meeting an error here.
				if (live) setReels([])
			})
		return () => {
			live = false
		}
	}, [checkpointKey])

	if (!reels || reels.length === 0) return null

	return (
		<div className="mt-4">
			<p className="label text-navy-soft">Already filmed this week?</p>
			<p className="mt-1 text-[0.82rem] leading-snug text-navy-soft">
				Handing this week in again? Pick the reel you posted for it before, rather than recording the same one twice.
			</p>
			<ul className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
				{reels.map(reel => {
					const selected = selectedId === reel.id
					return (
						<li key={reel.id}>
							<button
								aria-pressed={selected}
								className={cx(
									"sketch flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition-[background-color,transform] duration-150",
									selected ? "bg-teal/10" : "bg-white hover:bg-cream active:translate-y-px",
								)}
								onClick={() => onSelect(selected ? null : reel)}
								style={
									{
										"--sk-color": selected ? "var(--color-teal)" : undefined,
										"--sk-radius": "16px",
									} as React.CSSProperties
								}
								type="button"
							>
								<span className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-navy/10">
									{reel.thumbnailUrl ? (
										// Same origin as the feed's own <video> poster; next/image would need the bucket host allow-listed for a 96px tile.
										<img alt="" className="h-full w-full object-cover" loading="lazy" src={reel.thumbnailUrl} />
									) : (
										<IconFilm className="text-lg text-navy-soft" />
									)}
									{selected && (
										<span className="absolute inset-0 grid place-items-center bg-teal-ink/70 text-white">
											<IconCheck className="text-xl" strokeWidth={3.4} />
										</span>
									)}
								</span>
								<span className="min-w-0 flex-1">
									<span className="block truncate text-[0.9rem] font-bold text-navy">
										{reel.caption || "Your closing reel"}
									</span>
									<span className="hand mt-0.5 block text-[0.78rem] text-navy-soft tabular-nums">
										{new Date(reel.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
									</span>
								</span>
							</button>
						</li>
					)
				})}
			</ul>
		</div>
	)
}
