import type { CSSProperties } from "react"

type Props = {
  label: string
  /** Native size of the artwork the comp expects, e.g. "736 × 269". */
  ratio: string
  className?: string
  style?: CSSProperties
  /** Scales the interior fittings so a small card and a wide banner match. */
  scale?: number
  /**
   * Ground the slot sits on. `ink` is the default dark plate; `light` is for
   * slots that land on paper and carry the page's own ink text over them.
   */
  tone?: "ink" | "light"
  /**
   * A backdrop sits *behind* content rather than standing in for it. It drops
   * the centred caption, which would collide with whatever is set over it, and
   * leaves the accessibility tree, because a background image is decorative.
   * `label` and `ratio` still record, in source, what artwork belongs here.
   */
  backdrop?: boolean
}

const TONES = {
  ink: {
    ground: "bg-hl-ink",
    rule: "var(--color-hl-cyan)",
    edge: "border-hl-cyan/45",
    tick: "border-hl-cyan",
    title: "text-hl-cyan",
    caption: "text-hl-cyan/70",
  },
  light: {
    ground: "bg-hl-lavender",
    // Paper, not ink. The grid is a lighter line than its ground on the ink
    // tone too, and here that is what keeps it safe under type: an ink grid
    // darkened the ground enough to drop a soft label to 3.3:1, while a paper
    // one only ever lifts it. Ink lines survive on the ticks, which are the
    // slot's real signal and carry no text.
    rule: "var(--color-hl-paper)",
    edge: "border-hl-ink/40",
    tick: "border-hl-ink",
    title: "text-hl-ink",
    caption: "text-hl-ink-soft",
  },
} as const

/**
 * Reserved artwork slot.
 *
 * Drawn in the page's own silkscreen grammar — plate, registration ticks, a
 * measured grid — so an unfilled slot reads as a deliberate footprint waiting
 * for its part, not as a broken image. Swap it for `next/image` when the real
 * photograph exists; the wrapper's box is already the comp's box.
 */
export default function ImageSlot({
  label,
  ratio,
  className = "",
  style,
  scale = 1,
  tone = "ink",
  backdrop = false,
}: Props) {
  const tick = `${1.25 * scale}rem`
  const t = TONES[tone]

  return (
    <div
      className={`overflow-hidden ${t.ground} ${className}`}
      // `relative` is the default containing block for the fittings below, but
      // it lives in `style` so a caller can override it. As a class it could
      // not be beaten by a `className` of "absolute" — same specificity, and
      // stylesheet order decides — which silently drops positioned slots into
      // flow. Callers that place a slot pass `position` here instead.
      style={{ position: "relative", ...style }}
      {...(backdrop ? { "aria-hidden": true } : { role: "img", "aria-label": `Placeholder for ${label}` })}
    >
      {/* measured grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${t.rule} 0 1px, transparent 1px ${
            2.25 * scale
          }rem), repeating-linear-gradient(to bottom, ${t.rule} 0 1px, transparent 1px ${2.25 * scale}rem)`,
          maskImage: "radial-gradient(120% 120% at 50% 50%, #000 25%, transparent 78%)",
        }}
      />
      {/* registration ticks */}
      <span aria-hidden className={`pointer-events-none absolute inset-0 border-2 ${t.edge}`} />
      {(
        [
          ["top-0 left-0", "border-t-2 border-l-2"],
          ["top-0 right-0", "border-t-2 border-r-2"],
          ["bottom-0 left-0", "border-b-2 border-l-2"],
          ["bottom-0 right-0", "border-b-2 border-r-2"],
        ] as const
      ).map(([pos, edges]) => (
        <span
          key={pos}
          aria-hidden
          className={`pointer-events-none absolute ${pos} ${edges} ${t.tick}`}
          style={{ width: tick, height: tick }}
        />
      ))}

      {!backdrop && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[0.35em] px-4 text-center">
          <span
            className={`font-display font-bold uppercase ${t.title}`}
            style={{
              fontSize: `${0.95 * scale}rem`,
              letterSpacing: "0.14em",
              lineHeight: 1.1,
            }}
          >
            {label}
          </span>
          <span
            className={t.caption}
            style={{
              fontSize: `${0.75 * scale}rem`,
              letterSpacing: "0.1em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {ratio}
          </span>
        </div>
      )}
    </div>
  )
}
