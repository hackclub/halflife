import type { ReactNode, SVGProps } from "react"

/**
 * The console's icons: one set, one stroke weight, drawn on the same 24px grid and 1.8px round stroke as the platform's, but in the console's straight-edged hand. They are plain SVGs with no client behaviour, so a server page can render them.
 */

type P = SVGProps<SVGSVGElement>

function Ico({ children, ...p }: P & { children: ReactNode }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
			focusable="false"
			height="1em"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={1.8}
			viewBox="0 0 24 24"
			width="1em"
			{...p}
		>
			{children}
		</svg>
	)
}

/** The design half of a review: a pencil, not a colour. */
export const IconPencil = (p: P) => (
	<Ico {...p}>
		<path d="m4 20 1.1-4.2L16.4 4.5a2.1 2.1 0 0 1 3 3L8.1 18.9 4 20Z" />
		<path d="m14.6 6.3 3.1 3.1" />
	</Ico>
)

/** The build half of a review: a hammer, not a colour. */
export const IconHammer = (p: P) => (
	<Ico {...p}>
		<path d="m13.6 5.2 5.2 5.2-2.1 2.1-5.2-5.2 2.1-2.1Z" />
		<path d="M12.7 8.1 4 17v3h3l8.9-8.7" />
	</Ico>
)

export const IconChevronDown = (p: P) => (
	<Ico {...p}>
		<path d="m6 9 6 6 6-6" />
	</Ico>
)

export const IconSearch = (p: P) => (
	<Ico {...p}>
		<circle cx="11" cy="11" r="6.4" />
		<path d="m16 16 4.2 4.2" />
	</Ico>
)

export const IconFilter = (p: P) => (
	<Ico {...p}>
		<path d="M4 5.5h16l-6.2 7.2V19l-3.6 1.8v-8.1L4 5.5Z" />
	</Ico>
)

export const IconCheck = (p: P) => (
	<Ico {...p}>
		<path d="M5 12.5l4.5 4.5L19 7.5" />
	</Ico>
)

export const IconX = (p: P) => (
	<Ico {...p}>
		<path d="M6 6l12 12M18 6 6 18" />
	</Ico>
)
