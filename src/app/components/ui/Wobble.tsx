import type { CSSProperties } from "react"

/**
 * The comp's hand-drawn edges.
 *
 * Every outline in the Figma file — card borders, the rules between nav items,
 * the hairline down the page — is a wobbly ink stroke rather than a clean
 * rectangle. Reproducing that as exported artwork would mean a fixed-size
 * image per card, and the cards are fluid, so the corners would stretch.
 *
 * Instead the wobble is generated: an SVG rectangle whose stroke is pushed
 * around by a turbulence displacement map. That scales to any size, stays
 * crisp at any zoom, costs one filter definition for the whole page, and can
 * be varied per card with `seed` so two cards side by side are not identical
 * tracings of each other — which is what gives a hand-drawn look its life.
 *
 * The filter is applied to the BORDER ELEMENT ONLY, never to a container.
 * Filtering an element that holds text drags the text through the same
 * displacement and turns it to mush.
 */

export const WOBBLE_FILTER_ID = "hl-wobble"
export const WOBBLE_FILTER_SOFT_ID = "hl-wobble-soft"
export const WOBBLE_FILTER_PATH_ID = "hl-wobble-path"

/**
 * The filter definitions. Rendered once, in the platform layout.
 *
 * `baseFrequency` sets how often the line changes direction and `scale` how
 * far it strays. The pair here matches the comp's stroke: a slow wander of a
 * couple of pixels, not a jitter.
 */
export function WobbleDefs() {
	return (
		<svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: "absolute" }}>
			<defs>
				<filter id={WOBBLE_FILTER_ID} x="-5%" y="-5%" width="110%" height="110%">
					<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="7" result="noise" />
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				{/*
          For the rules between nav items.
          `filterUnits="userSpaceOnUse"` is load-bearing: a horizontal line has
          a ZERO-HEIGHT bounding box, so the default objectBoundingBox units
          multiply the region's height by nothing and the filter renders
          nothing at all. The rule's coordinate space is the 0 0 300 10 viewBox
          every WobbleRule uses, so the region can be stated outright.
        */}
				<filter id={WOBBLE_FILTER_SOFT_ID} filterUnits="userSpaceOnUse" x="-5" y="-5" width="310" height="20">
					<feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="3" seed="3" result="noise" />
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8" xChannelSelector="R" yChannelSelector="G" />
				</filter>
				{/*
          The connectors between checkpoint nodes. Their own region again,
          because the curve lives in a 0 0 100 60 viewBox rather than the
          rule's 300 x 10 one, and a region sized for the rule clips it.
        */}
				<filter id={WOBBLE_FILTER_PATH_ID} filterUnits="userSpaceOnUse" x="-20" y="-20" width="140" height="100">
					<feTurbulence type="fractalNoise" baseFrequency="0.08" numOctaves="2" seed="11" result="noise" />
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
				</filter>
			</defs>
		</svg>
	)
}

/**
 * A hand-drawn border, sized to whatever it is placed inside.
 *
 * The parent needs `position: relative` — `.hl-wobbly` does that and removes
 * the plain CSS border it replaces.
 */
export function WobbleBorder({
	radius = 10,
	stroke = "var(--color-border)",
	width = 2,
	seed,
}: Readonly<{ radius?: number; stroke?: string; width?: number; seed?: number }>) {
	// `seed` shifts the turbulence sample, so cards on the same screen get
	// different wobbles from one filter.
	const style: CSSProperties | undefined =
		seed === undefined ? undefined : { transform: `translateX(${(seed % 5) * 0.7}px)` }

	return (
		<svg aria-hidden="true" focusable="false" className="hl-wobble-svg" preserveAspectRatio="none" style={style}>
			{/* Geometry comes from CSS — see .hl-wobble-svg rect in globals.css.
          SVG attributes cannot take calc(), and silently collapse if given it. */}
			<rect
				rx={radius}
				ry={radius}
				fill="none"
				stroke={stroke}
				strokeWidth={width}
				filter={`url(#${WOBBLE_FILTER_ID})`}
			/>
		</svg>
	)
}

/** A hand-drawn horizontal rule — the line between nav items. */
export function WobbleRule({ stroke = "var(--color-border)" }: Readonly<{ stroke?: string }>) {
	return (
		<svg
			aria-hidden="true"
			focusable="false"
			className="hl-wobble-rule"
			preserveAspectRatio="none"
			viewBox="0 0 300 10"
		>
			<path
				d="M2 5 H298"
				fill="none"
				stroke={stroke}
				strokeWidth="2"
				strokeLinecap="round"
				filter={`url(#${WOBBLE_FILTER_SOFT_ID})`}
			/>
		</svg>
	)
}
