import Image, { type StaticImageData } from "next/image"

import bottomLeft from "../../../public/art/borders/bottomleftcorner.png"
import bottomRight from "../../../public/art/borders/bottomrightcorner.png"
import bottomRight2 from "../../../public/art/borders/bottomrightcorner2.png"
import topLeft from "../../../public/art/borders/topleftcorner.png"
import topLeft2 from "../../../public/art/borders/topleftcorner2.png"

/**
 * The corner decals, placed by their ink rather than by their frames.
 *
 * All five files are 1000x1000 with a wide, uneven transparent margin, and the unevenness is the whole reason this table exists: the right-hand margin runs 15.4% of the file on `bottomrightcorner` and 3.9% on `bottomrightcorner2`. Dropped flush to a plate's corners, the two would sit a quarter of a decal apart from each other, and neither would be at the corner. So `pad` is the alpha bounding box's distance from each edge as a fraction of the file, and it is what the placement below aligns – the drawing lands on the corner, and where the file's edge falls is arithmetic nobody has to look at.
 *
 * `inkW` does the same job for size. The five drawings fill their files differently – 746 units of ink across on one, 630 on another – so a shared render size would draw them at visibly different weights. Normalising on the ink instead means `INK` below is a promise about the drawing, not about the file it arrived in.
 *
 * These numbers are measured out of the committed files' alpha channel, not estimated. Replacing a file means re-measuring its row; the alternative was committing five trimmed derivatives, and `globals.css` already records what that costs – twice – in the note on `tile.png`.
 *
 * `corner` is not a placement choice, it is what each file is drawn for, which its own name states. There is no `toprightcorner` in the set, so no box can be wrapped on all four, and nothing here pretends otherwise.
 */
const DECALS = {
	bottomLeft: {
		corner: "bottom-left",
		inkW: 0.63,
		pad: { bottom: 0.187, left: 0.206, right: 0.164, top: 0.183 },
		src: bottomLeft,
	},
	bottomRight: {
		corner: "bottom-right",
		inkW: 0.714,
		pad: { bottom: 0.082, left: 0.132, right: 0.154, top: 0.155 },
		src: bottomRight,
	},
	bottomRight2: {
		corner: "bottom-right",
		inkW: 0.743,
		pad: { bottom: 0.078, left: 0.218, right: 0.039, top: 0.165 },
		src: bottomRight2,
	},
	topLeft: {
		corner: "top-left",
		inkW: 0.746,
		pad: { bottom: 0.103, left: 0.183, right: 0.071, top: 0.108 },
		src: topLeft,
	},
	topLeft2: {
		corner: "top-left",
		inkW: 0.645,
		pad: { bottom: 0.19, left: 0.17, right: 0.185, top: 0.195 },
		src: topLeft2,
	},
} as const satisfies Record<
	string,
	{
		src: StaticImageData
		corner: "top-left" | "bottom-left" | "bottom-right"
		pad: { left: number; top: number; right: number; bottom: number }
		inkW: number
	}
>

export type DecalName = keyof typeof DECALS

/**
 * How far the ink runs along the plate's edge, as a fraction of the plate's own width.
 *
 * A fraction rather than a length, so one number serves both layouts and every plate in them: 12% is 117 comp units on step 1's 975-wide plate and 67 on a 555-wide aside, which is the same mark at two scales rather than one mark that is emphatic on the small plate and lost on the large one. It needs no breakpoint and no `u()` – a percentage on an absolutely positioned child is already a fraction of the plate, so it scales with the stage for free.
 */
const INK = 0.12

/**
 * How far the ink is held off the corner.
 *
 * `rounded-xl`, which is what the plates are now cut with. Landing the ink's bounding corner exactly on the radius makes it tangent to the arc: the plate's own corner still reads as the boundary, and the decal sits inside it rather than painting it out. A decal is an ornament on the box, so the box has to survive it.
 *
 * It tracks the plates, so it moves when they do – this was 6px when they were cut `rounded-md`. A decal held off by less than the radius rides out over the arc and reads as a printing error.
 */
const INSET = "12px"

/**
 * How strongly the decals print.
 *
 * Derived, not chosen. These plates are full – the asides carry 160 characters of wrapped body copy and the header plate is one display word across 84% of its width – so at any size a decal reads as, text overprints it. Measured against the darkest fully-opaque pixel in the set, rgb(63,73,38), the two text-on-plate pairs give two ceilings for 4.5:1:
 *
 * ink #31222c on lavender-pale   0.55 indigo #34316c on lavender     0.30   <- the asides, and the binding one
 *
 * 0.30 is the stricter, so it is the one the whole set takes: one weight across seven plates beats two, and it holds in both layouts however the copy wraps. At it the worst overprint is 4.57:1.
 *
 * Shrinking them instead does not work, and it is worth writing down why. The decal is a share of the plate's width while the flow layout's padding is a flat 20px – 3% of a 672px plate – so any decal big enough to see crosses the padding and lands on the text anyway. Screening back is the only lever that scales.
 *
 * It also lands them in the page's own register. The section grounds print at 0.10, 0.12 and 0.18, so at 0.30 these are the loudest texture here by some margin and still texture rather than content – and the green, which is a hue this palette does not otherwise have, arrives screened rather than raw.
 */
const PRINT = 0.3

/**
 * A decal in one corner of the plate it is placed in.
 *
 * Absolutely positioned, so the plate must be a containing block – every stage plate already is, being absolute itself, and the two flow-layout plates were given `relative` for this.
 *
 * The offsets are a `translate`, not part of the `left`/`top` values, and that is the one trick here. Percentages in `translate` resolve against the element's own box, which is exactly what a `pad` fraction is measured against – so the correction is written once, in the units it was measured in, and needs no `calc` and no knowledge of how big the plate is. Doing it through `top` would resolve the vertical share against the plate's *height* and skew every decal by the plate's aspect ratio.
 *
 * `aria-hidden`, and `alt=""` under it: this is ornament, and a screen reader announcing "top left corner" five times down the section would be reading out the filing system.
 */
export default function CornerDecal({
	decal,
	over = false,
}: {
	decal: DecalName
	/**
	 * Print the decal over the plate's content instead of under it.
	 *
	 * Under is the default and the right answer everywhere text is involved: ornament goes on the stock, the words go on the ornament. `over` is for the one plate whose content is a full-bleed picture – under it, the decal is not screened back, it is simply not there.
	 */
	over?: boolean
}) {
	const { src, corner, pad, inkW } = DECALS[decal]

	// The rendered file, as a fraction of the plate – the ink's promised share divided back out through how much of its file the ink actually occupies.
	const size = INK / inkW

	const [vertical, horizontal] = corner.split("-")
	const fromLeft = horizontal === "left"
	const fromTop = vertical === "top"

	const shiftX = (fromLeft ? -pad.left : pad.right) * 100
	const shiftY = (fromTop ? -pad.top : pad.bottom) * 100

	return (
		<Image
			alt=""
			aria-hidden
			className="pointer-events-none absolute select-none"
			// The widest any decal is ever drawn: 19% of step 1's 975-unit plate at the stage's 1728 cap. The flow layout's plates top out at `max-w-2xl`, well under that, so one value covers both.
			sizes="190px"
			src={src}
			style={{
				height: "auto",
				opacity: PRINT,
				width: `${(size * 100).toFixed(3)}%`,
				// Under the plate's content but over its background. The plates carry `isolate` so this cannot escape into the page behind them.
				zIndex: over ? undefined : -1,
				[fromLeft ? "left" : "right"]: INSET,
				[fromTop ? "top" : "bottom"]: INSET,
				transform: `translate(${shiftX.toFixed(2)}%, ${shiftY.toFixed(2)}%)`,
			}}
		/>
	)
}
