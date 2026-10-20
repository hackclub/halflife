import { imageSources } from "@/components/platform/Markdown"

interface EntryImages {
	content: string | null
	createdAt: Date
}

interface ReelFrames {
	createdAt: Date
	/** The frame the pipeline made, when one exists. */
	thumbnailUrl: string | null
	/** The reel itself, whose opening frame stands in until then. */
	videoUrl: string | null
}

/**
 * How a project is pictured when it has no cover of its own.
 *
 * A reel frame can be a video, and a renderer has to know that – it uses a `<video>` and takes the opening frame – so the two kinds are told apart rather than flattened into one URL string that every caller would guess at.
 */
export type ProjectThumbnail = { kind: "image"; url: string } | { kind: "video"; url: string }

/**
 * The picture a project is shown by, in falling order: the cover the maker chose, the newest image in their journal, then the newest reel's own frame – a thumbnail if the pipeline made one, else the reel's opening frame.
 *
 * Null when there is none, and the caller falls back to the week's scene.
 */
export function projectThumbnail(
	chosenUrl: string | null,
	entries: EntryImages[],
	reels: ReelFrames[] = [],
): ProjectThumbnail | null {
	if (chosenUrl) return { kind: "image", url: chosenUrl }
	const journal = latestJournalImage(entries)
	if (journal) return { kind: "image", url: journal }
	return latestReelFrame(reels)
}

/**
 * The newest reel frame. A real thumbnail wins even on an older reel; the video is the last resort, and only ever the newest one.
 */
export function latestReelFrame(reels: ReelFrames[]): ProjectThumbnail | null {
	const newest = [...reels].toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
	let video: ProjectThumbnail | null = null
	for (const reel of newest) {
		if (reel.thumbnailUrl) return { kind: "image", url: reel.thumbnailUrl }
		if (!video && reel.videoUrl) video = { kind: "video", url: reel.videoUrl }
	}
	return video
}

export function latestJournalImage(entries: EntryImages[]): string | null {
	const newest = [...entries].toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
	for (const entry of newest) {
		const found = imageSources(entry.content ?? "")
		const last = found.at(-1)
		if (last) return last
	}
	return null
}
