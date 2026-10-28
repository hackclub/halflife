import Link from "next/link"
import type { ComponentPropsWithRef, ReactNode } from "react"

/**
 * Presentational primitives. These are the only files besides globals.css that know about colour, spacing or type – a page composes these and never writes a raw utility class.
 */

type Variant = "default" | "primary" | "danger"

const variantClass: Record<Variant, string> = {
	danger: "hl-btn hl-btn--danger",
	default: "hl-btn",
	primary: "hl-btn hl-btn--primary",
}

/** A base class plus whatever the caller adds, without a trailing space when it adds nothing. */
const withClass = (base: string, extra?: string): string => (extra ? `${base} ${extra}` : base)

export function Button({
	variant = "default",
	className,
	...props
}: Readonly<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
	return <button {...props} className={withClass(variantClass[variant], className)} />
}

/**
 * A link that is a button. The kit's own `Button` cannot be one: an `<a>` that navigates and a `<button>` that submits are different elements, and hand-writing `className="hl-btn"` on a `<Link>` is how a variant quietly goes missing. Pass the same `variant` here and Next's `Link` keeps the rest.
 */
export function LinkButton({
	variant = "default",
	className,
	...props
}: Readonly<ComponentPropsWithRef<typeof Link> & { variant?: Variant }>) {
	return <Link {...props} className={withClass(variantClass[variant], className)} />
}

export function Panel({
	title,
	actions,
	wide,
	children,
}: Readonly<{
	title?: ReactNode
	actions?: ReactNode
	/**
	 * Break out of the shell's reading column and use the full window width, for a diagram wider than that column. Pure CSS (`.hl-panel--wide`), so it never re-lays-out on its own – a measured width driven from state would resize the panel, which would re-measure it, and the diagram would jitter while the window is dragged.
	 */
	wide?: boolean
	children: ReactNode
}>) {
	return (
		<section
			className={wide ? "hl-panel hl-stack hl-stack--tight hl-panel--wide" : "hl-panel hl-stack hl-stack--tight"}
		>
			{(title || actions) && (
				<div className="hl-row" style={{ justifyContent: "space-between" }}>
					{title ? <h2 style={{ fontSize: "1.05rem", margin: 0 }}>{title}</h2> : <span />}
					{actions}
				</div>
			)}
			{children}
		</section>
	)
}

/**
 * The page title, hung from two straps pinned to the top of the page – the comp's own device, used on every console screen except the feed and reports, which lead with a heading row over a form or filter.
 *
 * `actions` sit below the board rather than beside it: the sign is centred, and a button floated next to it would pull the composition off axis.
 */
export function PageHeader({
	title,
	subtitle,
	actions,
}: Readonly<{ title: string; subtitle?: ReactNode; actions?: ReactNode }>) {
	return (
		<header>
			<div className="hl-sign">
				<div aria-hidden="true" className="hl-sign-straps">
					<span className="hl-sign-strap" />
					<span className="hl-sign-strap" />
				</div>
				<div className="hl-sign-board">
					{/* The tear lives on its own layer so the heading stays clean. */}
					<div aria-hidden="true" className="hl-sign-tear" />
					<h1>{title}</h1>
				</div>
			</div>
			{subtitle ? <p className="hl-sign-sub">{subtitle}</p> : null}
			{actions ? (
				<div className="hl-row" style={{ justifyContent: "center", marginTop: "1rem" }}>
					{actions}
				</div>
			) : null}
		</header>
	)
}

type BadgeTone = "success" | "warning" | "danger" | "muted" | "access"

export function Badge({
	tone = "muted",
	title,
	children,
}: Readonly<{ tone?: BadgeTone; title?: string; children: ReactNode }>) {
	return (
		<span className={`hl-badge hl-badge--${tone}`} title={title}>
			{children}
		</span>
	)
}

export function Callout({ tone, children }: Readonly<{ tone?: "danger" | "warning" | "info"; children: ReactNode }>) {
	return <div className={`hl-callout ${tone ? `hl-callout--${tone}` : ""}`}>{children}</div>
}

export function Stat({ label, value }: Readonly<{ label: string; value: ReactNode }>) {
	return (
		<div className="hl-stat">
			<div className="hl-stat-value">{value}</div>
			<div className="hl-stat-label">{label}</div>
		</div>
	)
}

export function EmptyState({ children }: Readonly<{ children: ReactNode }>) {
	return (
		<p className="hl-muted" style={{ margin: 0 }}>
			{children}
		</p>
	)
}

export function Field({ label, hint, children }: Readonly<{ label: string; hint?: ReactNode; children: ReactNode }>) {
	return (
		// biome-ignore lint/a11y/noLabelWithoutControl: the control is the children prop, which the rule cannot see through. Every call site passes a labelled input, select or textarea.
		<label className="hl-stack hl-stack--tight" style={{ gap: "0.25rem" }}>
			<span className="hl-label-text">{label}</span>
			{children}
			{hint ? <span className="hl-hint">{hint}</span> : null}
		</label>
	)
}

/*
 * The controls Field labels. They exist so the input style is applied by constructing the control, not by remembering to add a class next to it – the kit used to leave that to all sixty-odd call sites. `className` is still merged through for the handful that add `hl-mono`.
 */
export function TextInput({ className, ...props }: Readonly<ComponentPropsWithRef<"input">>) {
	return <input {...props} className={withClass("hl-input", className)} />
}

export function Select({ className, ...props }: Readonly<ComponentPropsWithRef<"select">>) {
	return <select {...props} className={withClass("hl-select", className)} />
}

export function TextArea({ className, ...props }: Readonly<ComponentPropsWithRef<"textarea">>) {
	return <textarea {...props} className={withClass("hl-textarea", className)} />
}

export function Table({
	head,
	children,
	className,
}: Readonly<{ head: ReactNode[]; children: ReactNode; className?: string }>) {
	return (
		<div className="hl-scroll">
			<table className={className ? `hl-table ${className}` : "hl-table"}>
				<thead>
					<tr>
						{head.map((h, i) => (
							<th key={i}>{h}</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	)
}

/** Status → tone, in one place so every surface agrees. */
export function statusTone(status: string): BadgeTone {
	switch (status) {
		case "approved":
			return "success"
		case "in_review":
			return "warning"
		case "rejected":
			return "danger"
		case "update_requested":
			return "warning"
		default:
			return "muted"
	}
}

export function statusLabel(status: string): string {
	return status.replaceAll("_", " ")
}
