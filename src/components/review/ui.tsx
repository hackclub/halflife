/**
 * Fabricate's small dashboard primitives, ported for the review platform.
 *
 * Same markup and class names as `app/javascript/components/ui` in Fabricate, so its stylesheet (copied into `app/(review)/styles`) applies unchanged. Inertia's `<Head>` is gone: the page title comes from each route's metadata instead.
 */
import type { ReactNode } from "react"

export function PageHead({
	actions,
	className,
	eyebrow,
	lead,
	title,
}: {
	actions?: ReactNode
	className?: string
	eyebrow?: ReactNode
	lead?: ReactNode
	title: ReactNode
}) {
	return (
		<div className={className ? `page-head ${className}` : "page-head"}>
			<div>
				<h1 className="page-head__title">
					{eyebrow ? <span className="page-head__eyebrow">{eyebrow}</span> : null}
					{title}
				</h1>
				{lead ? <p className="page-head__lead">{lead}</p> : null}
			</div>
			{actions ? <div className="page-head__actions">{actions}</div> : null}
		</div>
	)
}

export function Paper({
	actions,
	children,
	className,
	meta,
	title,
	variant,
}: {
	actions?: ReactNode
	children: ReactNode
	className?: string
	meta?: ReactNode
	title?: ReactNode
	variant?: "tight" | "flush" | "ink" | "flag"
}) {
	const classes = ["paper", variant ? `paper--${variant}` : "", className ?? ""].filter(Boolean).join(" ")
	return (
		<section className={classes}>
			{title || actions ? (
				<header className="paper__head">
					<div>
						{title ? <h2 className="paper__title">{title}</h2> : null}
						{meta ? <p className="paper__meta">{meta}</p> : null}
					</div>
					{actions ? <div className="form__actions">{actions}</div> : null}
				</header>
			) : null}
			{children}
		</section>
	)
}

const LABELS: { [_: string]: string } = Object.freeze({
	approved: "Approved",
	build: "Build",
	claimed: "Claimed",
	design: "Design",
	flagged: "Flagged",
	pending: "Pending",
	rejected: "Rejected",
	resubmission: "Resubmission",
	returned: "Returned",
	unverified: "Unverified",
})

export function StatusTag({ label, status }: { label?: string; status: string }) {
	let variant = ""
	if (status.endsWith("approved")) variant = " tag--filled"
	else if (status.endsWith("returned")) variant = " tag--dashed"
	else if (status.endsWith("rejected")) variant = " tag--muted"
	let tone = ""
	if (status.endsWith("approved")) tone = " tag--ok"
	else if (status.endsWith("pending") || status === "claimed") tone = " tag--warn"
	else if (
		status.endsWith("rejected")
		|| status.endsWith("returned")
		|| status === "flagged"
		|| status === "unverified"
	)
		tone = " tag--bad"
	return <span className={`tag${variant}${tone}`}>{label ?? LABELS[status] ?? status.replaceAll("_", " ")}</span>
}

export function TierTag({ requested = false, tier }: { requested?: boolean; tier: number | null }) {
	if (tier === null) return null
	return (
		<span className="tag" title={requested ? "Tier the maker asked for" : "Tier this project was approved at"}>
			Tier {tier}
		</span>
	)
}

export function isSafeUrl(url: string | null | undefined): url is string {
	if (!url) return false
	try {
		const parsed = new URL(url)
		return parsed.protocol === "http:" || parsed.protocol === "https:"
	} catch {
		return false
	}
}

export function SafeLink({
	children,
	className,
	href,
}: {
	children?: ReactNode
	className?: string
	href: string | null | undefined
}) {
	if (!isSafeUrl(href)) return <span className={className}>—</span>
	return (
		<a className={className} href={href} rel="noopener noreferrer" target="_blank">
			{children ?? href.replace(/^https?:\/\//, "")}
		</a>
	)
}

export function Field({
	children,
	className,
	error,
	hint,
	id,
	label,
	required,
}: {
	children: ReactNode
	className?: string
	error?: string | null
	hint?: ReactNode
	id: string
	label: string
	required?: boolean
}) {
	return (
		<div className={className ? `field ${className}` : "field"}>
			<label className="field__label" htmlFor={id}>
				{label}
				{required ? (
					<span aria-hidden="true" className="field__required">
						{" "}
						*
					</span>
				) : null}
			</label>
			{children}
			{hint && !error ? <p className="field__hint">{hint}</p> : null}
			{error ? (
				<p className="field__error" role="alert">
					{error}
				</p>
			) : null}
		</div>
	)
}

export function FormErrors({ errors }: { errors: string[] }) {
	if (errors.length === 0) return null
	return (
		<div className="form__errors" role="alert">
			<ul>
				{errors.map(message => (
					<li key={message}>{message}</li>
				))}
			</ul>
		</div>
	)
}

const PATHS = Object.freeze({
	backward:
		"M21 16.811c0 .864-.933 1.406-1.683.977l-7.108-4.061a1.125 1.125 0 0 1 0-1.954l7.108-4.061A1.125 1.125 0 0 1 21 8.689v8.122ZM11.25 16.811c0 .864-.933 1.406-1.683.977l-7.108-4.061a1.125 1.125 0 0 1 0-1.954l7.108-4.061a1.125 1.125 0 0 1 1.683.977v8.122Z",
	check: "m4.5 12.75 6 6 9-13.5",
	"chevron-down": "m19.5 8.25-7.5 7.5-7.5-7.5",
	"chevron-left": "M15.75 19.5 8.25 12l7.5-7.5",
	"chevron-right": "m8.25 4.5 7.5 7.5-7.5 7.5",
	"chevron-up": "m4.5 15.75 7.5-7.5 7.5 7.5",
	clock: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
	code: "m18 16 4-4-4-4M6 8l-4 4 4 4m8.5-12-5 16",
	expand:
		"M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15",
	forward:
		"M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061A1.125 1.125 0 0 1 3 16.811V8.69ZM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 0 1 0 1.954l-7.108 4.061a1.125 1.125 0 0 1-1.683-.977V8.69Z",
	fullscreen: "M3.75 8.25v-4.5h4.5M15.75 3.75h4.5v4.5M20.25 15.75v4.5h-4.5M8.25 20.25h-4.5v-4.5",
	image: "M3 3h18v18H3V3m6 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3M21 15l-4-4L7 21",
	link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
	list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
	"list-ordered": "M10 6h11m-11 6h11m-11 6h11M4 6h1v4M4 10h2m0 8H4c0-1 2-2 2-3s-1-1.5-2-1",
	pause: "M15.75 5.25v13.5m-7.5-13.5v13.5",
	play: "M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z",
	quote: "M17 6H3m18 6H8m13 6H8M3 12v6",
	replay:
		"M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99",
	shrink:
		"M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25",
	warning:
		"M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z",
	x: "M6 18 18 6M6 6l12 12",
})

export type IconName = keyof typeof PATHS

export function Icon({ className, name }: { className?: string; name: IconName }) {
	return (
		<svg
			aria-hidden="true"
			className={className ? `icon ${className}` : "icon"}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.5}
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d={PATHS[name]} strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	)
}
