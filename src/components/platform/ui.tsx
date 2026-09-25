"use client"

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react"

export { cx } from "@/lib/cx"

import { cx } from "@/lib/cx"

/* ------------------------------------------------------------------ *
 * Panel — the cream card with a wobbling marker outline
 * ------------------------------------------------------------------ */
export function Panel({
  children,
  className,
  tone = "line",
  radius = 16,
  variant = 1,
  as: As = "div",
}: {
  children: ReactNode
  className?: string
  tone?: "line" | "violet" | "sky" | "teal" | "gold" | "coral" | "navy"
  radius?: number
  variant?: 1 | 2 | 3
  as?: "div" | "section" | "article" | "aside" | "li"
}) {
  const color = {
    line: "var(--color-line)",
    violet: "var(--color-violet)",
    sky: "var(--color-sky)",
    teal: "var(--color-teal)",
    gold: "var(--color-gold-deep)",
    coral: "var(--color-coral)",
    navy: "var(--color-navy)",
  }[tone]

  return (
    <As
      className={cx("sketch", variant === 2 && "sketch-2", variant === 3 && "sketch-3", className)}
      style={
        {
          "--sk-color": color,
          "--sk-radius": `${radius}px`,
          // The drawn border lives on a pseudo-element, so the panel's own
          // background does not inherit its radius — a light fill sits in a
          // square box and pokes out past the rounded corners. Most panels hide
          // it by being nearly the colour of the page; a white one does not.
          borderRadius: `${radius}px`,
        } as React.CSSProperties
      }
    >
      {children}
    </As>
  )
}

/* ------------------------------------------------------------------ *
 * Accent text
 * ------------------------------------------------------------------ */
const ACCENT_TEXT: Record<string, string> = {
  "var(--color-sky)": "var(--color-sky-ink)",
  "var(--color-teal)": "var(--color-teal-ink)",
  "var(--color-orange)": "var(--color-orange-ink)",
  "var(--color-violet)": "var(--color-violet-deep)",
  "var(--color-gold)": "var(--color-gold-ink)",
  "var(--color-coral)": "var(--color-coral-deep)",
}

/**
 * An accent, as text on cream. The accents are fills first — sky as a label
 * on cream is 2.37:1 — so a label drawn "in the week's colour" takes that
 * colour's ink instead. Magenta and the deep tones already read, and pass
 * through unchanged.
 */
export function accentText(accent: string): string {
  return ACCENT_TEXT[accent] ?? accent
}

/**
 * What goes on top of an accent fill: navy, except on the one fill dark enough
 * for white. White on sky, teal, orange and violet is 1.98–3.37:1; navy on
 * them is 4.64–7.90. The pill is the counter's ground on the same banner.
 */
export function onAccent(accent: string): { text: string; pill: string } {
  return accent === "var(--color-magenta)"
    ? { text: "#ffffff", pill: "rgb(0 0 0 / 0.15)" }
    : { text: "var(--color-navy)", pill: "rgb(255 255 255 / 0.25)" }
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "outline" | "ghost" | "gold" | "teal" | "coral"
  size?: "sm" | "md" | "lg"
  full?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "solid", size = "md", full, className, children, ...rest },
  ref,
) {
  const sizes = {
    sm: "h-9 px-3.5 text-[0.76rem]",
    md: "h-11 px-5 text-[0.85rem]",
    lg: "h-13 px-7 text-[0.95rem]",
  }[size]

  const variants = {
    // Each solid fill is the deep tone, rimmed and hovered one darker: a white
    // label on the plain violet, teal and coral read 3.37, 2.80 and 3.33:1.
    solid:
      "bg-violet-deep text-white border-violet-dark hover:bg-violet-dark active:translate-y-px disabled:bg-line disabled:border-line-strong",
    gold: "bg-gold text-navy border-gold-deep hover:brightness-105 active:translate-y-px disabled:bg-line disabled:border-line-strong disabled:text-navy-soft",
    teal: "bg-teal-deep text-white border-teal-dark hover:bg-teal-dark active:translate-y-px disabled:bg-line disabled:border-line-strong",
    coral:
      "bg-coral-deep text-white border-coral-dark hover:bg-coral-dark active:translate-y-px disabled:bg-line disabled:border-line-strong",
    outline:
      "bg-transparent text-navy border-violet hover:bg-violet-pale active:translate-y-px disabled:text-navy-soft disabled:border-line",
    ghost: "bg-transparent text-navy-soft border-transparent hover:text-navy hover:bg-black/5",
  }[variant]

  return (
    <button
      ref={ref}
      className={cx(
        "label inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 whitespace-nowrap",
        "transition-[background-color,color,transform,filter] duration-150",
        "disabled:cursor-not-allowed disabled:opacity-70",
        sizes,
        variants,
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

/* ------------------------------------------------------------------ *
 * Torn tape — the week banner / page signs
 * ------------------------------------------------------------------ */
export function Tape({
  children,
  className,
  color = "var(--color-sky)",
  soft = false,
}: {
  children?: ReactNode
  className?: string
  color?: string
  soft?: boolean
}) {
  return (
    <div className={cx("relative", className)}>
      <div
        aria-hidden="true"
        className={cx("absolute inset-0", soft ? "torn-soft" : "torn")}
        style={{
          background: color,
          borderRadius: 4,
          boxShadow: "0 3px 6px rgba(28,26,89,.1), 0 14px 30px -14px rgba(28,26,89,.4)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Option row — the big pick-one buttons used across every modal
 * ------------------------------------------------------------------ */
export function OptionRow({
  children,
  selected,
  onClick,
  disabled,
  tone = "violet",
  hint,
}: {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
  tone?: "violet" | "gold" | "sky"
  hint?: ReactNode
}) {
  const ring = {
    violet: "var(--color-violet)",
    gold: "var(--color-gold-deep)",
    sky: "var(--color-sky-deep)",
  }[tone]
  const fill = {
    violet: "var(--color-violet-pale)",
    gold: "var(--color-gold-pale)",
    sky: "var(--color-sky-pale)",
  }[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={cx(
        "sketch group relative block w-full rounded-2xl px-5 py-3.5 text-left transition-colors duration-150",
        disabled ? "cursor-not-allowed opacity-55" : "hover:bg-white",
      )}
      style={
        {
          "--sk-color": ring,
          "--sk-radius": "14px",
          background: selected ? fill : "var(--color-paper)",
        } as React.CSSProperties
      }
    >
      <span className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className={cx(
            "grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
            selected ? "border-transparent" : "border-line-strong",
          )}
          style={{ background: selected ? ring : "transparent" }}
        >
          {selected && <span className="size-2 rounded-full bg-white" />}
        </span>
        <span className="min-w-0 flex-1">{children}</span>
      </span>
      {hint && <span className="mt-1.5 block pl-8 text-[0.78rem] leading-snug text-navy-soft">{hint}</span>}
    </button>
  )
}

/* ------------------------------------------------------------------ *
 * Progress bar
 * ------------------------------------------------------------------ */
export function Meter({
  value,
  max,
  label,
  tone = "teal",
  className,
}: {
  value: number
  max: number
  label?: string
  tone?: "teal" | "gold" | "sky"
  className?: string
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100))
  const fill = { teal: "var(--color-teal)", gold: "var(--color-gold)", sky: "var(--color-sky)" }[tone]
  const track = { teal: "var(--color-mint)", gold: "var(--color-gold-pale)", sky: "var(--color-sky-pale)" }[tone]
  return (
    <div
      className={cx("relative h-5 w-full overflow-hidden rounded-full", className)}
      style={{ background: track }}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label ?? "Progress"}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{ width: `${pct}%`, background: fill }}
      />
      {label && (
        <span className="hand absolute inset-0 grid place-items-center text-[0.68rem] font-semibold text-navy">
          {label}
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Small marker-drawn pill
 * ------------------------------------------------------------------ */
export function Chip({
  children,
  tone = "sky",
  className,
}: {
  children: ReactNode
  tone?: "sky" | "teal" | "gold" | "coral" | "violet" | "muted"
  className?: string
}) {
  const tones = {
    sky: "bg-sky-pale text-sky-ink",
    teal: "bg-mint text-teal-ink",
    gold: "bg-gold-pale text-gold-ink",
    coral: "bg-coral/15 text-coral-dark",
    violet: "bg-violet-pale text-violet-deep",
    muted: "bg-black/5 text-navy-soft",
  }[tone]
  return (
    <span className={cx("label inline-flex items-center gap-1.5 rounded-full px-2.5 py-1", tones, className)}>
      {children}
    </span>
  )
}

/* ------------------------------------------------------------------ *
 * Field
 * ------------------------------------------------------------------ */
export function Field({
  label,
  hint,
  children,
  id,
}: {
  label: string
  hint?: string
  children: ReactNode
  id?: string
}) {
  return (
    <div>
      <label htmlFor={id} className="label block text-violet-deep">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[0.78rem] text-navy-soft">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  )
}

/**
 * A field with a border that is always there.
 *
 * This used to lean on `.sketch`, which draws on a pseudo-element an `<input>`
 * cannot hold, so the outline never rendered and a field showed no edge at all
 * until the focus ring arrived. It is DESIGN.md's bordered field now: a real
 * 2px border in `field` (3.68:1 on white — `line` was 1.72, under the 3:1 a
 * control's boundary needs), `navy-soft` on hover, violet on focus.
 */
export const borderedInputClass =
  "block w-full rounded-xl border-2 border-field bg-black/[.02] px-4 py-3 text-[0.95rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-navy-soft focus:border-violet focus:bg-white"

/** The same field, under the name every caller already imports. */
export const inputClass = borderedInputClass
