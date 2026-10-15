import { FAQS } from "@/lib/site/content"

/**
 * Comp geometry: a 1615-wide field of 725 × 323 plates, two up, 56px apart (Figma 275:158-177). The comp's grey containing panel is dropped – its only job was separating the field from the band behind it, and the palette shift to periwinkle now does that.
 */

/** The comp's plate and the gutter between two of them. */
const PLATE_W = 725
const GUTTER = 56

/**
 * Every measurement of a plate is the comp's own, scaled by this.
 *
 * At full size the plates read as display type doing a body job – a 40px question over a 30px answer – and the plates themselves stretched to 779 across the 1615 field, wider than the 725 the comp drew. So the whole card comes down as one piece: shrinking the type inside a box that stayed put would have left the type adrift in its own padding.
 *
 * One knob. Nudge it and the plate, its padding, both type sizes and the gutter all move together – and the answer's measure does not move at all, because a uniform scale cannot change a ratio. It sits at 43 characters either way, which is the measure the comp's own numbers describe.
 */
const CARD_SCALE = 0.75

/**
 * A comp size as a clamp. Only the fluid slope and the ceiling take the scale: the rem floor is the phone's size, where the field is already one column reading correctly and 0.75 of 16px body copy would be 12px.
 */
const size = (floorRem: number, vw: number, maxPx: number) =>
	`clamp(${floorRem}rem, ${+(vw * CARD_SCALE).toFixed(4)}vw, ${+(maxPx * CARD_SCALE).toFixed(2)}px)`

const FIELD = {
	/** Two scaled plates and the gutter between them, and nothing wider. The
	 *  section's own 1615 field stays put so the heading keeps its measure. */
	grid: `${(PLATE_W * 2 + GUTTER) * CARD_SCALE}px`,
	gutter: size(1.25, 3.24, GUTTER),
	padding: size(1.25, 2.37, 41),
	question: size(1.35, 2.32, 40),
	answer: size(1, 1.74, 30),
} as const

export default function Faq() {
	return (
		<section aria-labelledby="faq-heading" className="hl-ground-hatch bg-hl-blue text-hl-ink" id="faq">
			<div className="mx-auto max-w-[1615px] px-4 py-20 sm:px-8 min-[1180px]:px-[3.4vw] min-[1180px]:py-28">
				<h2
					className="text-center font-display font-bold tracking-[-0.025em]"
					id="faq-heading"
					style={{ fontSize: "clamp(2.25rem, 5.8vw, 6rem)", lineHeight: 1 }}
				>
					Frequently Asked Questions
				</h2>

				<dl
					className="mx-auto mt-12 grid min-[1180px]:mt-20"
					style={{
						maxWidth: FIELD.grid,
						// 26rem is deliberately not scaled: it is the width at which two columns become one, not a size. Scaled with the rest it would have let a third column into the row and lost the comp's two up.
						gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 26rem), 1fr))",
						gap: FIELD.gutter,
					}}
				>
					{FAQS.map(faq => (
						<div
							className="flex flex-col bg-hl-ink text-hl-blue rounded-md"
							key={faq.q}
							style={{ padding: FIELD.padding }}
						>
							<dt className="font-display font-bold" style={{ fontSize: FIELD.question, lineHeight: 1.1 }}>
								{faq.q}
							</dt>
							<dd className="mt-[0.85em] text-hl-paper" style={{ fontSize: FIELD.answer, lineHeight: 1.45 }}>
								{faq.a}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	)
}
