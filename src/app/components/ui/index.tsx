import type { ReactNode } from "react"

/**
 * Presentational primitives. These are the only files besides globals.css that know about colour, spacing or type – a page composes these and never writes a raw utility class.
 */

type Variant = "default" | "primary" | "danger"

const variantClass: Record<Variant, string> = {
	danger: "hl-btn hl-btn--danger",
	default: "hl-btn",
	primary: "hl-btn hl-btn--primary",
}

function Button({
	variant = "default",
	className,
	...props
}: Readonly<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
	return <button {...props} className={`${variantClass[variant]} ${className ?? ""}`} />
}

function Panel({
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
 * The page title, hung from two straps pinned to the top of the page – the comp's own device, used on every screen.
 *
 * `actions` sit below the board rather than beside it: the sign is centred, and a button floated next to it would pull the composition off axis.
 */
function PageHeader({
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

/**
 * Close / dismiss.
 *
 * Drawn rather than the Unicode ✕: that glyph's weight, size and baseline come from whatever font happens to render it, so it never matches the stroke of anything around it.
 */
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

export { Button, PageHeader, Panel }
