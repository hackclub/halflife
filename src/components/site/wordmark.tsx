import type { StaticImageData } from "next/image"

import Image from "next/image"
import { BRAND } from "@/lib/site/content"
import logoArt from "../../../public/art/logo.png"

const LOGO_SRC: StaticImageData | null = logoArt

/**
 * The box the artwork is laid into – the file's own aspect, read off the file.
 *
 * It used to be a hardcoded 1125/787, measured off a logo.svg whose ink sat in a 1280-square canvas, with `object-cover` trimming the transparent air back off. That worked exactly as long as the file did not change. The replacement was a 3000-square png whose ink ran y 381-2225 – sitting high, 381 of padding above against 774 below – and `cover` centres its crop, so it opened its window at y 451 and sheared 70px off the top of the wordmark while leaving 324px of slack unused underneath.
 *
 * Two hardcoded numbers are gone instead of being corrected. The file was trimmed to its own ink, so its dimensions now *are* the artwork, and the box takes its ratio from the import rather than from anything typed here. A replacement logo of any shape gets a box of that shape.
 */
const LOGO_ASPECT = LOGO_SRC ? LOGO_SRC.width / LOGO_SRC.height : 1

interface Props {
	/**
	 * Renders `LOGO_SRC` instead of live type. The hero opts in; the footer does not, because it recolours its wordmark to cyan with `text-hl-cyan!` and a traced SVG carries its fills baked in – cream at 88% opacity across 664 of its 853 paths – so no `color` can reach them. Live Masterpiece stays the only wordmark that can take a colour.
	 */
	art?: boolean
	/**
	 * How wide the artwork runs, as a CSS length. Height follows from the file's own aspect, so a caller never has to know it.
	 *
	 * Width is the dimension a caller actually reasons in – the mark reads as "this much of the screen across". What a caller cannot see from here is how much height that buys: the ink is 1125 x 787, so every unit of width brings 0.7 of height with it, and the callers say where that lands.
	 */
	artWidth?: string
	/** Renders as the page's h1 in the hero, plain text elsewhere. */
	as?: "h1" | "p" | "span"
	className?: string
	/** Font size for the live-type fallback, as a CSS length. */
	fontSize?: string
	/** The artwork's `sizes`, for a caller that runs it at another width. */
	sizes?: string
}

export default function Wordmark({
	as = "span",
	className = "",
	fontSize,
	art = false,
	artWidth,
	sizes = "(min-width: 1180px) 35vw, 42vw",
}: Props) {
	const Tag = as

	if (art && LOGO_SRC) {
		return (
			<Tag className={`relative block ${className}`}>
				<span className="sr-only">{BRAND.name}</span>
				{/* `mx-auto` so the box still centres when a caller hands the tag a
            full-width class: the artwork is narrower than the tag now, and a
            block child does not answer to the plate's `text-center`. */}
				<span className="relative mx-auto block" style={{ aspectRatio: String(LOGO_ASPECT), width: artWidth }}>
					{/* Contain, not cover. Cover was there to trim transparent air off a
              file that had some; with the box now cut from the file's own
              proportions the two agree, so neither fits differently – and
              contain is the safe one of the pair, because a file that ever
              disagrees again is letterboxed rather than cut into. */}
					<Image
						alt=""
						className="object-contain"
						fill
						priority
						// The old src was an `.svg`, which next/image serves unoptimized – no srcset, no quality, `sizes` declared for the `fill` contract and nothing else. A png goes through the optimizer, so both now matter: 90 to match the rest of the page's artwork, since 75 on a flat two-colour wordmark is where banding shows first.
						quality={90}
						sizes={sizes}
						src={LOGO_SRC}
					/>
				</span>
			</Tag>
		)
	}

	return (
		<Tag className={`font-hand leading-[0.86] text-white ${className}`} style={{ fontSize, letterSpacing: "-0.045em" }}>
			{BRAND.name.toLowerCase()}
		</Tag>
	)
}
