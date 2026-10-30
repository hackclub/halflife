import Image from "next/image"
import Link from "next/link"
import { DISPLAY_STARTERS, type DisplayStarter, displayPhotoSrc } from "@/lib/config/display-starters"

/** Four fill the top row; the remaining three sit centred beneath it. */
const ROWS = [DISPLAY_STARTERS.slice(0, 4), DISPLAY_STARTERS.slice(4)] as const

const TILE =
	"tile-corners group relative block aspect-square w-full overflow-hidden bg-cream focus-visible:-outline-offset-4"

/**
 * The week-4 nudge email's picture of the seven guides: the contact sheet from `/display-guides` stood on its own, four squares to a row with the other three centred underneath, and the hours it takes spelled out below. It has no route – it was drawn in a temporary page, screenshotted, and left here as the source for the image.
 */
export function DisplayGuidesSheet() {
	return (
		<section className="bg-cream px-4 py-8 sm:px-8 sm:py-12">
			<div className="mx-auto w-full max-w-[760px]">
				<div className="flex items-baseline justify-between gap-3 pb-3">
					<h2 className="label text-navy-soft">All 7 displays</h2>
					<p className="hand text-[0.8rem] text-navy-soft">easiest first</p>
				</div>
				<ul className="grid grid-cols-4 gap-0.5 pb-0.5">
					{ROWS[0].map(d => (
						<GuideTile key={d.slug} starter={d} />
					))}
				</ul>
				<ul className="mx-auto grid w-3/4 grid-cols-3 gap-0.5">
					{ROWS[1].map(d => (
						<GuideTile key={d.slug} starter={d} />
					))}
				</ul>

				<p className="hand mt-5 text-center text-[0.86rem] leading-relaxed text-navy-soft">
					3-8 hours each, with parts lists, wiring, code, and a finished project to aim for
				</p>
			</div>
		</section>
	)
}

function GuideTile({ starter }: { starter: DisplayStarter }) {
	return (
		<li>
			<Link className={TILE} href={`/display-guides/${starter.slug}`}>
				<Image
					alt={starter.photo.alt}
					className="object-cover transition-transform duration-300 ease-(--ease-spring) group-hover:scale-105"
					fill
					sizes="(min-width: 760px) 180px, 25vw"
					src={displayPhotoSrc(starter.photo.file)}
				/>
				<span className="absolute bottom-2 left-2 max-w-[calc(100%_-_1rem)] rounded-md bg-white/90 px-1.5 py-0.5 text-left text-[0.9rem] leading-tight font-extrabold text-navy">
					{starter.title}
				</span>
			</Link>
		</li>
	)
}
