"use client"

import { useEffect, useRef, useState } from "react"
import { isVideoUrl } from "@/components/review/format"
import { Icon } from "@/components/review/ui"

/** A grid of thumbnails that opens into a full-screen viewer. Fabricate's `ImageGallery`, unchanged in behaviour. */
export function ImageGallery({ urls }: { urls: string[] }) {
	const [index, setIndex] = useState<number | null>(null)
	const dialog = useRef<HTMLDialogElement>(null)
	const multiple = urls.length > 1

	useEffect(() => {
		const el = dialog.current
		if (!el) return
		if (index !== null && !el.open) el.showModal()
		if (index === null && el.open) el.close()
	}, [index])

	if (urls.length === 0) return null

	const step = (delta: number): void => setIndex(i => (i === null ? i : (i + delta + urls.length) % urls.length))
	const current = index === null ? null : urls[index]

	return (
		<>
			<div className="entry__images">
				{urls.map((url, i) => (
					<a
						href={url}
						key={url}
						onClick={e => {
							if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
							e.preventDefault()
							setIndex(i)
						}}
					>
						{isVideoUrl(url) ? (
							<video muted playsInline preload="metadata" src={url} />
						) : (
							<img alt="" loading="lazy" src={url} />
						)}
					</a>
				))}
			</div>
			<dialog
				aria-label="Image viewer"
				className="viewer"
				onClick={e => {
					if (e.target === e.currentTarget) setIndex(null)
				}}
				onClose={() => setIndex(null)}
				onKeyDown={e => {
					if (!multiple) return
					if (e.key === "ArrowLeft") step(-1)
					if (e.key === "ArrowRight") step(1)
				}}
				ref={dialog}
			>
				{current ? (
					<>
						{isVideoUrl(current) ? (
							// biome-ignore lint/a11y/useMediaCaption: a participant upload, and there is no caption file to point a track at. An empty track is announced as an empty caption, which is worse than none.
							<video autoPlay className="viewer__image" controls playsInline src={current} />
						) : (
							<img alt="" className="viewer__image" src={current} />
						)}
						<div className="viewer__bar">
							{multiple && index !== null ? (
								<span className="viewer__count">
									{index + 1} / {urls.length}
								</span>
							) : null}
							<a className="viewer__link" href={current} rel="noopener noreferrer" target="_blank">
								Open original
							</a>
							<button aria-label="Close" className="viewer__btn" onClick={() => setIndex(null)} type="button">
								<Icon name="x" />
							</button>
						</div>
						{multiple ? (
							<>
								<button
									aria-label="Previous image"
									className="viewer__btn viewer__nav viewer__nav--prev"
									onClick={() => step(-1)}
									type="button"
								>
									<Icon name="chevron-left" />
								</button>
								<button
									aria-label="Next image"
									className="viewer__btn viewer__nav viewer__nav--next"
									onClick={() => step(1)}
									type="button"
								>
									<Icon name="chevron-right" />
								</button>
							</>
						) : null}
					</>
				) : null}
			</dialog>
		</>
	)
}
