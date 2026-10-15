import type { SVGProps } from "react"

/**
 * One icon set, one stroke weight. Everything is drawn on a 24px grid with a 1.8px round-joined stroke so the marks sit next to the hand-lettering without looking imported from somewhere else.
 */

type P = SVGProps<SVGSVGElement>

function Ico({ children, ...p }: P & { children: React.ReactNode }) {
	return (
		<svg
			aria-hidden="true"
			fill="none"
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

export const IconHome = (p: P) => (
	<Ico {...p}>
		<path d="M3.6 10.4 12 3.6l8.4 6.8" />
		<path d="M5.6 9.2V19a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.2" />
		<path d="M9.8 20.4v-5.6h4.4v5.6" />
	</Ico>
)

export const IconCompass = (p: P) => (
	<Ico {...p}>
		<circle cx="12" cy="12" r="8.6" />
		<path d="M15.6 8.4 13.8 13.8 8.4 15.6l1.8-5.4Z" />
	</Ico>
)

export const IconBag = (p: P) => (
	<Ico {...p}>
		<path d="M5.4 8h13.2l-1.1 11a1.4 1.4 0 0 1-1.4 1.3H7.9a1.4 1.4 0 0 1-1.4-1.3Z" />
		<path d="M9 8V6.6a3 3 0 0 1 6 0V8" />
		<path d="M9.4 11.4v1.2M14.6 11.4v1.2" />
	</Ico>
)

export const IconBook = (p: P) => (
	<Ico {...p}>
		<path d="M4.2 5.2A1.4 1.4 0 0 1 5.6 3.8H11a1.4 1.4 0 0 1 1 .5l.2.2.2-.2a1.4 1.4 0 0 1 1-.5h5.4a1.4 1.4 0 0 1 1.4 1.4v12.4a1.4 1.4 0 0 1-1.4 1.4H13a1.4 1.4 0 0 0-1 .4l-.2.2-.2-.2a1.4 1.4 0 0 0-1-.4H5.6a1.4 1.4 0 0 1-1.4-1.4Z" />
		<path d="M12.2 4.8v14.6" />
	</Ico>
)

export const IconTrophy = (p: P) => (
	<Ico {...p}>
		<path d="M7.4 4h9.2v4.2a4.6 4.6 0 0 1-9.2 0Z" />
		<path d="M7.4 5.4H5a1 1 0 0 0-1 1v.8a3 3 0 0 0 3 3h.6M16.6 5.4H19a1 1 0 0 1 1 1v.8a3 3 0 0 1-3 3h-.6" />
		<path d="M12 12.8v3.6M8.8 20.2h6.4M9.8 16.4h4.4l.8 3.8H9Z" />
	</Ico>
)

export const IconFlame = (p: P) => (
	<Ico {...p}>
		<path d="M12.6 2.6c.4 2.6-.6 4-2 5.4S8 11 8 13.2a4.3 4.3 0 0 0 8.6.3c0-1.3-.4-2.3-1-3.2.9.3 1.7 1 2.2 1.9.3-3.6-1.6-7.5-5.2-9.6Z" />
		<path d="M11.4 14.2c.9.5 1.4 1.3 1.4 2.3" />
	</Ico>
)

export const IconCoin = (p: P) => (
	<Ico {...p}>
		<ellipse cx="12" cy="7.6" rx="7.4" ry="3.2" />
		<path d="M4.6 7.6v3.2c0 1.8 3.3 3.2 7.4 3.2s7.4-1.4 7.4-3.2V7.6" />
		<path d="M4.6 11.6v3.2c0 1.8 3.3 3.2 7.4 3.2s7.4-1.4 7.4-3.2v-3.2" />
	</Ico>
)

export const IconCheck = (p: P) => (
	<Ico {...p} strokeWidth={2.6}>
		<path d="M4.8 12.6 9.6 17.4 19.2 6.8" />
	</Ico>
)

export const IconLock = (p: P) => (
	<Ico {...p}>
		<rect height="9.4" rx="2.2" width="14.4" x="4.8" y="10.4" />
		<path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" />
		<path d="M12 14.2v2" />
	</Ico>
)

export const IconPlay = (p: P) => (
	<Ico {...p}>
		<path d="M8.4 5.6 18.6 12 8.4 18.4Z" />
	</Ico>
)

export const IconPause = (p: P) => (
	<Ico {...p}>
		<path d="M8.2 5.6v12.8M15.8 5.6v12.8" strokeWidth={2.6} />
	</Ico>
)

export const IconVolume = (p: P) => (
	<Ico {...p}>
		<path d="M4.4 9.4h3.2l4.6-3.8v12.8l-4.6-3.8H4.4Z" />
		<path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />
	</Ico>
)

export const IconVolumeOff = (p: P) => (
	<Ico {...p}>
		<path d="M4.4 9.4h3.2l4.6-3.8v12.8l-4.6-3.8H4.4Z" />
		<path d="m15.4 9.6 4.8 4.8M20.2 9.6l-4.8 4.8" />
	</Ico>
)

export const IconArrowDown = (p: P) => (
	<Ico {...p}>
		<path d="M12 4.8v14.4M6 13.2l6 6 6-6" />
	</Ico>
)

export const IconSend = (p: P) => (
	<Ico {...p}>
		<path d="M12 18.6V5.8M6.6 11.2 12 5.8l5.4 5.4" strokeWidth={2.2} />
	</Ico>
)

export const IconFilm = (p: P) => (
	<Ico {...p}>
		<rect height="13.2" rx="2.2" width="17.2" x="3.4" y="5.4" />
		<path d="M8 5.4v13.2M16 5.4v13.2M3.4 12h17.2M3.4 8.7h4.6M3.4 15.3h4.6M16 8.7h4.6M16 15.3h4.6" />
	</Ico>
)

export const IconCamera = (p: P) => (
	<Ico {...p}>
		<path d="M3.6 8.6a1.8 1.8 0 0 1 1.8-1.8h2l1.3-2h6.6l1.3 2h2a1.8 1.8 0 0 1 1.8 1.8v8.6a1.8 1.8 0 0 1-1.8 1.8H5.4a1.8 1.8 0 0 1-1.8-1.8Z" />
		<circle cx="12" cy="13" r="3.6" />
	</Ico>
)

export const IconClock = (p: P) => (
	<Ico {...p}>
		<circle cx="12" cy="12" r="8.6" />
		<path d="M12 7v5.4l3.4 2" />
	</Ico>
)

export const IconPlus = (p: P) => (
	<Ico {...p}>
		<path d="M12 5.4v13.2M5.4 12h13.2" />
	</Ico>
)

export const IconX = (p: P) => (
	<Ico {...p}>
		<path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />
	</Ico>
)

export const IconTrash = (p: P) => (
	<Ico {...p}>
		<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.8 12.2h9.4L17.5 7M10.2 10.6v5.2M13.8 10.6v5.2" />
	</Ico>
)

export const IconChevronRight = (p: P) => (
	<Ico {...p}>
		<path d="m9.4 5.6 6.4 6.4-6.4 6.4" />
	</Ico>
)

export const IconChevronLeft = (p: P) => (
	<Ico {...p}>
		<path d="M14.6 5.6 8.2 12l6.4 6.4" />
	</Ico>
)

export const IconChevronsUp = (p: P) => (
	<Ico {...p}>
		<path d="m6 13.4 6-6 6 6M6 18.4l6-6 6 6" />
	</Ico>
)

export const IconChevronDown = (p: P) => (
	<Ico {...p}>
		<path d="m5.6 9.4 6.4 6.4 6.4-6.4" />
	</Ico>
)

export const IconChevronUp = (p: P) => (
	<Ico {...p}>
		<path d="m5.6 14.6 6.4-6.4 6.4 6.4" />
	</Ico>
)

export const IconUpload = (p: P) => (
	<Ico {...p}>
		<path d="M12 16.4V4.6M7.6 9 12 4.6 16.4 9" />
		<path d="M4.6 15.4v3a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-3" />
	</Ico>
)

export const IconHeart = (p: P) => (
	<Ico {...p}>
		<path d="M12 19.8s-7.6-4.4-7.6-9.3A4.2 4.2 0 0 1 12 8.2a4.2 4.2 0 0 1 7.6 2.3c0 4.9-7.6 9.3-7.6 9.3Z" />
	</Ico>
)

export const IconComment = (p: P) => (
	<Ico {...p}>
		<path d="M20 12.6a7.4 7.4 0 0 1-7.9 7.3L6.4 21l1.2-4.2A7.4 7.4 0 1 1 20 12.6Z" />
	</Ico>
)

export const IconEye = (p: P) => (
	<Ico {...p}>
		<path d="M2.8 12S6.4 5.8 12 5.8 21.2 12 21.2 12 17.6 18.2 12 18.2 2.8 12 2.8 12Z" />
		<circle cx="12" cy="12" r="2.8" />
	</Ico>
)

export const IconLogout = (p: P) => (
	<Ico {...p}>
		<path d="M14.6 7.4V5.6a1.6 1.6 0 0 0-1.6-1.6H6.2a1.6 1.6 0 0 0-1.6 1.6v12.8a1.6 1.6 0 0 0 1.6 1.6H13a1.6 1.6 0 0 0 1.6-1.6v-1.8" />
		<path d="M10.2 12h9.2M16.4 8.8l3.2 3.2-3.2 3.2" />
	</Ico>
)

export const IconPencil = (p: P) => (
	<Ico {...p}>
		<path d="M16.4 4.2 19.8 7.6 8.6 18.8l-4.2.8.8-4.2Z" />
		<path d="m14.4 6.2 3.4 3.4" />
	</Ico>
)

export const IconFile = (p: P) => (
	<Ico {...p}>
		<path d="M6 3.8h7.2L18.6 9v11.2a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" />
		<path d="M13 3.8V9h5.6" />
	</Ico>
)

export const IconCart = (p: P) => (
	<Ico {...p}>
		<path d="M3.4 4.6h2.4l2.2 10.2h9.2l2-7H6.6" />
		<circle cx="9.4" cy="19" r="1.4" />
		<circle cx="16.8" cy="19" r="1.4" />
	</Ico>
)

export const IconArrowRight = (p: P) => (
	<Ico {...p}>
		<path d="M4.6 12h14.8M13.6 6.2 19.4 12l-5.8 5.8" />
	</Ico>
)

export const IconWarning = (p: P) => (
	<Ico {...p}>
		<path d="M12 4.4 21 19.6H3Z" />
		<path d="M12 10v4M12 16.6v.6" />
	</Ico>
)

export const IconMic = (p: P) => (
	<Ico {...p}>
		<rect height="11" rx="3" width="6" x="9" y="3.4" />
		<path d="M5.6 12a6.4 6.4 0 0 0 12.8 0M12 18.4v2.2" />
	</Ico>
)
