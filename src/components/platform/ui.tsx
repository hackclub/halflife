"use client"

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react"
import { cx } from "@/lib/cx"

export { cx } from "@/lib/cx"

/* ------------------------------------------------------------------ *
 * Panel – the cream card with a wobbling marker outline
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
	tone?: "line" | "violet" | "sky" | "teal" | "orange" | "gold" | "coral" | "navy"
	radius?: number
	variant?: 1 | 2 | 3
	as?: "div" | "section" | "article" | "aside" | "li"
}) {
	const color = {
		coral: "var(--color-coral)",
		gold: "var(--color-gold-deep)",
		line: "var(--color-line)",
		navy: "var(--color-navy)",
		orange: "var(--color-orange)",
		sky: "var(--color-sky)",
		teal: "var(--color-teal)",
		violet: "var(--color-violet)",
	}[tone]

	return (
		<As
			className={cx("sketch", variant === 2 && "sketch-2", variant === 3 && "sketch-3", className)}
			style={
				{
					"--sk-color": color,
					"--sk-radius": `${radius}px`,
					// The drawn border lives on a pseudo-element, so the panel's own background does not inherit its radius – a light fill sits in a square box and pokes out past the rounded corners. Most panels hide it by being nearly the colour of the page; a white one does not.
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
const ACCENT_TEXT: { [_: string]: string } = {
	"var(--color-coral)": "var(--color-coral-deep)",
	"var(--color-gold)": "var(--color-gold-ink)",
	"var(--color-orange)": "var(--color-orange-ink)",
	"var(--color-sky)": "var(--color-sky-ink)",
	"var(--color-teal)": "var(--color-teal-ink)",
	"var(--color-violet)": "var(--color-violet-deep)",
}

/**
 * An accent, as text on cream. The accents are fills first – sky as a label on cream is 2.37:1 – so a label drawn "in the week's colour" takes that colour's ink instead. Magenta and the deep tones already read, and pass through unchanged.
 */
export function accentText(accent: string): string {
	return ACCENT_TEXT[accent] ?? accent
}

/**
 * What goes on top of an accent fill: navy, except on the one fill dark enough for white. White on sky, teal, orange and violet is 1.98-3.37:1; navy on them is 4.64-7.90. The pill is the counter's ground on the same banner.
 */
export function onAccent(accent: string): { text: string; pill: string } {
	return accent === "var(--color-magenta)"
		? { pill: "rgb(0 0 0 / 0.15)", text: "#ffffff" }
		: { pill: "rgb(255 255 255 / 0.25)", text: "var(--color-navy)" }
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	full?: boolean
	size?: "sm" | "md" | "lg"
	variant?: "solid" | "outline" | "ghost" | "gold" | "teal" | "coral"
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ variant = "solid", size = "md", full, className, children, ...rest }, ref) => {
		const sizes = {
			lg: "h-13 px-7 text-[0.95rem]",
			md: "h-11 px-5 text-[0.85rem]",
			sm: "h-9 px-3.5 text-[0.76rem]",
		}[size]

		const variants = {
			coral:
				"bg-coral-deep text-white border-coral-dark hover:bg-coral-dark active:translate-y-px disabled:bg-line disabled:border-line-strong",
			ghost: "bg-transparent text-navy-soft border-transparent hover:text-navy hover:bg-black/5 active:translate-y-px",
			gold: "bg-gold text-navy border-gold-deep hover:brightness-105 active:translate-y-px disabled:bg-line disabled:border-line-strong disabled:text-navy-soft",
			outline:
				"bg-transparent text-navy border-violet hover:bg-violet-pale active:translate-y-px disabled:text-navy-soft disabled:border-line",
			// Each solid fill is the deep tone, rimmed and hovered one darker: a white label on the plain violet, teal and coral read 3.37, 2.80 and 3.33:1.
			solid:
				"bg-violet-deep text-white border-violet-dark hover:bg-violet-dark active:translate-y-px disabled:bg-line disabled:border-line-strong",
			teal: "bg-teal-deep text-white border-teal-dark hover:bg-teal-dark active:translate-y-px disabled:bg-line disabled:border-line-strong",
		}[variant]

		return (
			<button
				className={cx(
					"label inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border-2 whitespace-nowrap",
					"transition-[background-color,color,transform,filter] duration-150",
					"disabled:cursor-not-allowed disabled:opacity-70",
					sizes,
					variants,
					full && "w-full",
					className,
				)}
				ref={ref}
				{...rest}
			>
				{children}
			</button>
		)
	},
)
// A forwardRef is an object rather than a function, so React DevTools has no name to show for it and the component reads as "ForwardRef" in a stack trace. Told one, it is "Button" in both.
Button.displayName = "Button"

/* ------------------------------------------------------------------ *
 * Option row – the big pick-one buttons used across every modal
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
	onClick?(): void
	disabled?: boolean
	tone?: "violet" | "gold" | "sky"
	hint?: ReactNode
}) {
	const ring = {
		gold: "var(--color-gold-deep)",
		sky: "var(--color-sky-deep)",
		violet: "var(--color-violet)",
	}[tone]
	const fill = {
		gold: "var(--color-gold-pale)",
		sky: "var(--color-sky-pale)",
		violet: "var(--color-violet-pale)",
	}[tone]

	return (
		<button
			aria-pressed={selected}
			className={cx(
				"sketch group relative block w-full rounded-2xl px-5 py-3.5 text-left transition-colors duration-150",
				disabled ? "cursor-not-allowed opacity-55" : "hover:bg-white",
			)}
			disabled={disabled}
			onClick={onClick}
			style={
				{
					"--sk-color": ring,
					"--sk-radius": "14px",
					background: selected ? fill : "var(--color-paper)",
				} as React.CSSProperties
			}
			type="button"
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
	const fill = { gold: "var(--color-gold)", sky: "var(--color-sky)", teal: "var(--color-teal)" }[tone]
	const track = { gold: "var(--color-gold-pale)", sky: "var(--color-sky-pale)", teal: "var(--color-mint)" }[tone]
	return (
		<div
			aria-label={label ?? "Progress"}
			aria-valuemax={max}
			aria-valuemin={0}
			aria-valuenow={value}
			className={cx("relative h-5 w-full overflow-hidden rounded-full", className)}
			role="progressbar"
			style={{ background: track }}
		>
			<div
				className="h-full rounded-full transition-[width] duration-700 ease-out"
				style={{ background: fill, width: `${pct}%` }}
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
		coral: "bg-coral/15 text-coral-dark",
		gold: "bg-gold-pale text-gold-ink",
		muted: "bg-black/5 text-navy-soft",
		sky: "bg-sky-pale text-sky-ink",
		teal: "bg-mint text-teal-ink",
		violet: "bg-violet-pale text-violet-deep",
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
			<label className="label block text-violet-deep" htmlFor={id}>
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
 * This used to lean on `.sketch`, which draws on a pseudo-element an `<input>` cannot hold, so the outline never rendered and a field showed no edge at all until the focus ring arrived. It is DESIGN.md's bordered field now: a real 2px border in `field` (3.68:1 on white – `line` was 1.72, under the 3:1 a control's boundary needs), `navy-soft` on hover, violet on focus.
 */
export const borderedInputClass =
	"block w-full rounded-xl border-2 border-field bg-black/[.02] px-4 py-3 text-[0.95rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-navy-soft focus:border-violet focus:bg-white"

/** The same field, under the name every caller already imports. */
export const inputClass = borderedInputClass
