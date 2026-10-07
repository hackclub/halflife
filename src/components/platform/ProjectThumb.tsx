import { cx } from "@/lib/cx"
import type { ProjectThumbnail } from "@/lib/thumbnail"

/**
 * A project's stand-in picture: an image, or a reel's opening frame.
 *
 * A video here is muted, has no controls, and is asked for the frame at 0.1s, so it reads as a still even though the element could play it.
 */
export function ProjectThumb({ thumb, className }: { thumb: ProjectThumbnail; className?: string }) {
	if (thumb.kind === "video") {
		return (
			<video
				src={`${thumb.url}#t=0.1`}
				className={cx("object-cover", className)}
				muted
				playsInline
				preload="metadata"
				aria-hidden
			/>
		)
	}
	return (
		// eslint-disable-next-line @next/next/no-img-element -- R2, or a URL the maker pasted into a journal
		<img src={thumb.url} alt="" loading="lazy" className={cx("object-cover", className)} />
	)
}
