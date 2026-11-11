"use client"

import type { ReactNode } from "react"
import { formatDuration, isVideoUrl } from "@/components/review/format"
import { ImageGallery } from "@/components/review/ImageGallery"
import { TimelapsePlayer } from "@/components/review/TimelapsePlayer"
import { Paper, StatusTag } from "@/components/review/ui"
import type { ReviewEntry } from "@/lib/review-platform/types"

const entryDate = (iso: string): string =>
	new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
		day: "numeric",
		month: "short",
		timeZone: "UTC",
		year: "numeric",
	})

/**
 * One journal entry, as Fabricate's review screen shows it: the body, its images, its timelapses and – when a reviewer may act – the deflation controls underneath.
 *
 * Lapse recordings play in Fabricate's own player, open by default as on Fabricate's review screen; a recording uploaded to Half Life's own bucket is a plain video.
 */
export function JournalEntryView({ entry, reviewer }: { entry: ReviewEntry; reviewer?: ReactNode }) {
	const title = entry.title.trim()
	const date = entryDate(entry.date)
	return (
		<Paper
			actions={
				<span className="entry__time">
					{formatDuration(entry.secondsSpent)}
					{entry.approvedSeconds !== null && entry.approvedSeconds !== entry.secondsSpent ? (
						<span className="entry__date"> → {formatDuration(entry.approvedSeconds)} counted</span>
					) : null}
				</span>
			}
			meta={
				<>
					{title ? date : null}
					{entry.countsHours ? null : (
						<>
							{title ? " · " : null}
							<StatusTag label="Hackatime-tracked" status="tracked" />
						</>
					)}
				</>
			}
			title={title || date}
		>
			{entry.bodyHtml ? (
				<div className="user-md" dangerouslySetInnerHTML={{ __html: entry.bodyHtml }} />
			) : (
				<p className="field__hint">No write-up.</p>
			)}
			<ImageGallery urls={entry.imageUrls} />
			{entry.timelapseUrls.length > 0 ? (
				<div className="entry__lapses">
					{entry.timelapseUrls.map(url =>
						isVideoUrl(url) ? (
							// biome-ignore lint/a11y/useMediaCaption: a participant upload, and there is no caption file to point a track at. An empty track is announced as an empty caption, which is worse than none.
							<video className="entry__lapse-video" controls key={url} playsInline preload="none" src={url} />
						) : (
							<TimelapsePlayer defaultOpen key={url} playable url={url} />
						),
					)}
				</div>
			) : null}
			{reviewer}
		</Paper>
	)
}
