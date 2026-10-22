import { cx } from "@/lib/cx"
import type { ProjectThumbnail } from "@/lib/thumbnail"

/**
 * A project's stand-in picture: an image, or a reel's opening frame.
 *
 * A video here is muted, has no controls, and is asked for the frame at 0.1s, so it reads as a still even though the element could play it. The picture is shown whole and centred rather than filling the box, the same way the week's painted stand-in is, so a tall photo of a project is not cropped down to a landscape card; every caller puts a colour behind it for the space that leaves.
 */
export function ProjectThumb({ thumb, className }: { thumb: ProjectThumbnail; className?: string }) {
	if (thumb.kind === "video")
		return (
			<video
				aria-hidden
				className={cx("object-contain", className)}
				muted
				playsInline
				preload="metadata"
				src={`${thumb.url}#t=0.1`}
			/>
		)

	return (
		// R2, or a URL the maker pasted into a journal
		<img alt="" className={cx("object-contain", className)} loading="lazy" src={thumb.url} />
	)
}
