/**
 * Comp-space helpers.
 *
 * The approved comp is the Figma frame "landing page (claude)" (275:8), 1728px wide. Everything inside a `.stage` is expressed as a fraction of that width in `cqw` units, so a value written here is literally the number of pixels it measures in Figma.
 */

const COMP_WIDTH = 1728

/** One comp pixel, as a container-relative length. */
function u(px: number): string {
	return `${((px / COMP_WIDTH) * 100).toFixed(5)}cqw`
}

/** Absolute box, in comp pixels. */
function box(
	x: number,
	y: number,
	w: number,
	h: number,
): { readonly left: string; readonly top: string; readonly width: string; readonly height: string } {
	return { height: u(h), left: u(x), top: u(y), width: u(w) } as const
}

/** Absolute origin only – lets content size itself. */
function at(x: number, y: number): { readonly left: string; readonly top: string } {
	return { left: u(x), top: u(y) } as const
}

/** Type set in comp pixels. */
function type(size: number, lineHeight = 1.05): { readonly fontSize: string; readonly lineHeight: number } {
	return { fontSize: u(size), lineHeight } as const
}

/**
 * The connector bands' taper – thick end over thin.
 *
 * The comp's four bands came in at 1.07, 1.09, 1.19 and 1.20, and two of them tapered one way while two tapered the other. Under about 1.3 the eye reads a taper as a drawing error rather than a decision, so all four were flat and inconsistently flat. At 1.6 the wide end is half again the narrow one, which is unmistakable, and every band now runs the same way: thin where it leaves the plate above, thick where it lands on the one below. A band that gathers as it descends makes each arrival a weld rather than a dwindle, which is the industrial read this page is after.
 */
const BAND_TAPER = 1.6

/**
 * A connector band, built from its centreline instead of exported path data.
 *
 * `from` and `to` are the midpoints of the band's two ends – the comp's own axis, untouched – and `mean` is its average perpendicular thickness, also the comp's. Holding the mean is what lets the taper change without changing the page's weight: each band keeps the presence the comp gave it, and keeps the progression between them, where the line grows as the programme does (92 through the first joint, 120 through the last).
 *
 * The ends are horizontal cuts, not perpendicular ones, because that is how they meet the plates. So an end's thickness is its edge foreshortened by the axis's own slope, and the edge that delivers a wanted thickness is that thickness divided back out – which is why the paths carry no round numbers.
 */
function band(
	from: readonly [number, number],
	to: readonly [number, number],
	mean: number,
): { x: number; y: number; w: number; h: number; d: string } {
	const [x0, y0] = from
	const [x1, y1] = to
	const dx = x1 - x0
	const dy = y1 - y0
	const foreshorten = Math.abs(dy) / Math.hypot(dx, dy)

	const thin = (2 * mean) / (1 + BAND_TAPER) / foreshorten
	const thick = thin * BAND_TAPER

	const topLeft = x0 - thin / 2
	const topRight = x0 + thin / 2
	const botLeft = x1 - thick / 2
	const botRight = x1 + thick / 2

	const left = Math.min(topLeft, botLeft)
	const r = (n: number) => Number(n.toFixed(2))
	const h = r(dy)

	return {
		d: `M${r(topLeft - left)} 0H${r(topRight - left)}L${r(botRight - left)} ${h}H${r(botLeft - left)}Z`,
		h,
		w: r(Math.max(topRight, botRight) - left),
		x: r(left),
		y: y0,
	}
}

/** A plate on the comp grid, in comp pixels. */
interface Plate {
	h: number
	w: number
	x: number
	y: number
}

/** Declare a plate. `box(...spread)` draws it; `weld` joins it to another. */
function plate(x: number, y: number, w: number, h: number): Plate {
	return { h, w, x, y }
}

/**
 * A weld between two plates – the band, expressed as the joint it actually is.
 *
 * `band` takes a centreline, which means whoever calls it has to know where both plates are and keep two absolute midpoints in agreement with them by hand. That is how the page ended up with a connector drawn in one coordinate system landing on a plate laid out in another: the bands were a copy of the plates' truth rather than derived from it, so a plate could move and its band would not.
 *
 * A weld is named against the plates instead. `at` is how far along the edge the end sits, as a fraction of that plate's own width, so a plate that is resized keeps its band near the same corner. `rise` and `drop` are how far the end reaches *inside* the plate it meets, which is the overlap that makes the joint a weld and not two shapes touching. Move a plate – or grow one, the way step 1 grew to hold its heading – and both its bands follow.
 */
function weld(
	exit: { plate: Plate; at: number; rise: number },
	entry: { plate: Plate; at: number; drop: number },
	mean: number,
): { x: number; y: number; w: number; h: number; d: string } {
	return band(
		[exit.plate.x + exit.plate.w * exit.at, exit.plate.y + exit.plate.h - exit.rise],
		[entry.plate.x + entry.plate.w * entry.at, entry.plate.y + entry.drop],
		mean,
	)
}

/**
 * The stacked layout's weld, on the same taper and the same anchor pair.
 *
 * Not `weld`: these svgs scale with `preserveAspectRatio="none"`, so a thickness measured perpendicular to the run would not survive the stretch – the taper goes on the horizontal edges directly, which is the one dimension the viewBox and the box agree about. `STACK_ANCHORS` is where the run leaves and lands across the 200-unit box, and a weld takes the pair in whichever order it leans, so one band's exit is the last one's entry and the zigzag down the column is continuous. Both were hand-drawn before and the left-leaning one missed its own pair by 5 units.
 */
const STACK_MEAN_EDGE = 85
const STACK_ANCHORS = [70, 135] as const
const STACK_VIEW = { h: 120, w: 200 } as const

function stackWeld(lean: "left" | "right"): string {
	const [near, far] = lean === "right" ? STACK_ANCHORS : [STACK_ANCHORS[1], STACK_ANCHORS[0]]
	const thin = (2 * STACK_MEAN_EDGE) / (1 + BAND_TAPER)
	const thick = thin * BAND_TAPER
	const r = (n: number) => Number(n.toFixed(2))

	return `M${r(near - thin / 2)} 0H${r(near + thin / 2)}L${r(far + thick / 2)} ${STACK_VIEW.h}H${r(far - thick / 2)}Z`
}

/** A plate's absolute box, for `style`. */
function plateBox(p: Plate): {
	readonly left: string
	readonly top: string
	readonly width: string
	readonly height: string
} {
	return box(p.x, p.y, p.w, p.h)
}

/**
 * The swash behind the hero's tagline and email field, and the inset the two keep from its edge.
 *
 * It lives here rather than in `signup-form.tsx` because both ends of it are needed on both sides of the client boundary: the form draws the padding, and the hero has to size the box from the same number. The form is a client component, so a plain function exported from it cannot be called while the hero renders on the server.
 *
 * `brushstroke.png` is 2000x400 and its interior is one flat `#103070` – RGB standard deviation under 1.4 across 578k opaque pixels, 52 distinct colours in the whole of it – so there is no bristle texture to distort and it can be stretched to the box outright. Everything the file is carrying lives in its alpha: a soft rim, and two tapered ends running 12% of the width on the left and 28% on the right.
 *
 * Which is what these numbers are for. Laid on the box at its own size the tagline would run 2%-98% of it and put its own ends in those tapers, over the painting, so the box's padding is what holds the type in the stroke's solid part instead of the flat 2rem it used to need against ink.
 *
 * The horizontal inset is a share of the box, so it holds at every width; the vertical one is `em` of the size the caller sets, because a percentage padding resolves against the width on both axes and would be meaningless here. Their two jobs are different: X clears the ends, Y clears the rim.
 *
 * Measured, at the worst pixel under the type rather than on average. At a 12.5% inset the type occupies the middle 75% of the stroke's width, and 1.8em holds it inside the middle 54-60% of its height at every size either layout sets – a band whose lowest alpha is 0.667. The lightest thing that can be behind it is bg.png's own brightest pixel across the plate's footprint, `#1698a9` once the art layer's 0.66 is applied, which is 2.94:1 to paper bare and 6.95:1 through the stroke. So the tagline clears 4.5:1 at any size, not just at the 3:1 its 32.8 comp px would owe.
 *
 * The rounded corner went with the ink. The stroke's own alpha is 0.000 at all four corners of the box, so the radius had nothing left to round.
 */
const SWASH_INSET_X = 0.125
const SWASH_INSET_Y = "1.8em"

/**
 * How wide the box has to be for a line of `n` to sit inside that inset.
 *
 * The stage's tagline is one `whitespace-nowrap` line of a known measure, and the box used to be sized by it: as the widest child of a centred flex column it shrank to the line and landed on 865 against the plate's own 864. A percentage padding cannot do that – it is treated as zero while the box is working out its own max-content, so the box would still stop at the line and then take the inset out of it, clipping 25% of the sentence.
 *
 * So in the stage the box is given its width instead of finding it, and this is the arithmetic: the line is the middle 75%, so the box is the line over 0.75. The stacked layout needs none of this – its tagline wraps inside a column that is already explicit.
 */
function swashBoxWidth(lineRun: number): number {
	return lineRun / (1 - 2 * SWASH_INSET_X)
}

export {
	at,
	BAND_TAPER,
	band,
	box,
	COMP_WIDTH,
	type Plate,
	plate,
	plateBox,
	STACK_VIEW,
	SWASH_INSET_X,
	SWASH_INSET_Y,
	stackWeld,
	swashBoxWidth,
	type,
	u,
	weld,
}
