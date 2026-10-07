import Link from "next/link"
import type { ReactNode } from "react"

/**
 * Presentational primitives. These are the only files besides globals.css that
 * know about colour, spacing or type – a page composes these and never writes a
 * raw utility class.
 */

type Variant = "default" | "primary" | "danger"

const variantClass: Record<Variant, string> = {
	default: "hl-btn",
	primary: "hl-btn hl-btn--primary",
	danger: "hl-btn hl-btn--danger",
}

export function Button({
	variant = "default",
	className,
	...props
}: Readonly<React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>) {
	return <button {...props} className={`${variantClass[variant]} ${className ?? ""}`} />
}

export function LinkButton({
	href,
	variant = "default",
	children,
}: Readonly<{ href: string; variant?: Variant; children: ReactNode }>) {
	return (
		<Link href={href} className={variantClass[variant]}>
			{children}
		</Link>
	)
}

export function Panel({
	title,
	actions,
	children,
}: Readonly<{ title?: ReactNode; actions?: ReactNode; children: ReactNode }>) {
	return (
		<section className="hl-panel hl-stack hl-stack--tight">
			{(title || actions) && (
				<div className="hl-row" style={{ justifyContent: "space-between" }}>
					{title ? <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{title}</h2> : <span />}
					{actions}
				</div>
			)}
			{children}
		</section>
	)
}

/**
 * The page title, hung from two straps pinned to the top of the page – the
 * comp's own device, used on every screen.
 *
 * `actions` sit below the board rather than beside it: the sign is centred,
 * and a button floated next to it would pull the composition off axis.
 */
export function PageHeader({
	title,
	subtitle,
	actions,
}: Readonly<{ title: string; subtitle?: ReactNode; actions?: ReactNode }>) {
	return (
		<header>
			<div className="hl-sign">
				<div className="hl-sign-straps" aria-hidden="true">
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

type BadgeTone = "success" | "warning" | "danger" | "muted"

export function Badge({ tone = "muted", children }: Readonly<{ tone?: BadgeTone; children: ReactNode }>) {
	return <span className={`hl-badge hl-badge--${tone}`}>{children}</span>
}

export function Callout({ tone, children }: Readonly<{ tone?: "danger" | "warning" | "info"; children: ReactNode }>) {
	return <div className={`hl-callout ${tone ? `hl-callout--${tone}` : ""}`}>{children}</div>
}

/**
 * Close / dismiss.
 *
 * Drawn rather than the Unicode ✕: that glyph's weight, size and baseline come
 * from whatever font happens to render it, so it never matches the stroke of
 * anything around it.
 */
/**
 * A participant's avatar, falling back to the programme's own art.
 *
 * The comp puts a gato illustration in the account card rather than an empty
 * square, and most participants will not have set a picture – so the fallback
 * is the common case, not the edge case.
 *
 * Not next/image: an avatar URL comes from Slack or R2 and its host is only
 * known at runtime, which next/image refuses unless it is listed at build time.
 */
export function Avatar({
	src,
	large = false,
	alt = "",
}: Readonly<{ src?: string | null; large?: boolean; alt?: string }>) {
	const className = `hl-avatar${large ? " hl-avatar--lg" : ""}`
	if (src) {
		// eslint-disable-next-line @next/next/no-img-element
		return <img className={className} src={src} alt={alt} />
	}
	return (
		<span className={`${className} hl-avatar--fallback`} role="img" aria-label={alt || "No picture set"}>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src="/brand/gato/schematic.png" alt="" />
		</span>
	)
}

export function CloseIcon({ size = 18 }: Readonly<{ size?: number }>) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			aria-hidden="true"
			focusable="false"
		>
			<path d="M6 6l12 12M18 6L6 18" />
		</svg>
	)
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

export function Table({ head, children }: Readonly<{ head: ReactNode[]; children: ReactNode }>) {
	return (
		<div className="hl-scroll">
			<table className="hl-table">
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
	return status.replace(/_/g, " ")
}
