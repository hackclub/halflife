"use client"

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useId,
	useRef,
	useSyncExternalStore,
} from "react"
import { createPortal } from "react-dom"
import { IconX } from "@/components/platform/icons"
import { accentText } from "@/components/platform/ui"
import { cx } from "@/lib/cx"

/**
 * The id the dialog's `aria-labelledby` points at. `Modal` provides it so a `ModalTitle` that does not carry its own `id` still names the dialog; the dialogs that predate this passed `labelledBy` and an `id` themselves.
 */
const ModalTitleId = createContext<string | undefined>(undefined)

const FOCUSABLE =
	'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

/* The server has no body to portal into, and no effect is needed to find that out. */
const neverChanges = () => () => {}
const useIsClient = () =>
	useSyncExternalStore(
		neverChanges,
		() => true,
		() => false,
	)

export function Modal({
	open,
	onClose,
	eyebrow,
	accent = "var(--color-violet)",
	children,
	footer,
	size = "md",
	labelledBy,
	dismissible = true,
	scrollKey,
}: {
	open: boolean
	onClose(): void
	/** Step counter or section name, rendered in the accent colour. */
	eyebrow?: ReactNode
	accent?: string
	children: ReactNode
	footer?: ReactNode
	size?: "md" | "lg" | "xl"
	labelledBy?: string
	dismissible?: boolean
	/** Change this when the content swaps so the body scrolls back to the top. */
	scrollKey?: string | number
}) {
	const ref = useRef<HTMLDivElement>(null)
	const body = useRef<HTMLDivElement>(null)
	const restoreTo = useRef<HTMLElement | null>(null)
	const titleId = useId()
	const isClient = useIsClient()

	// Parents commonly pass an inline onClose. Keep the latest callback in a ref so a re-render caused by typing does not restart the focus-trap effect (its cleanup restores focus and its setup focuses the first control again).
	const onCloseRef = useRef(onClose)
	useEffect(() => {
		onCloseRef.current = onClose
	}, [onClose])

	const close = useCallback(() => {
		if (dismissible) onCloseRef.current()
	}, [dismissible])

	useEffect(() => {
		if (!open) return
		restoreTo.current = document.activeElement as HTMLElement | null
		const prevOverflow = document.body.style.overflow
		document.body.style.overflow = "hidden"

		const node = ref.current
		const first = node?.querySelector<HTMLElement>(FOCUSABLE)
		;(first ?? node)?.focus()

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation()
				close()
				return
			}
			if (e.key !== "Tab" || !node) return
			const items = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
				el => el.offsetParent !== null || el === document.activeElement,
			)
			const firstEl = items[0]
			const lastEl = items.at(-1)
			if (!firstEl || !lastEl) return
			if (e.shiftKey && document.activeElement === firstEl) {
				e.preventDefault()
				lastEl.focus()
			} else if (!e.shiftKey && document.activeElement === lastEl) {
				e.preventDefault()
				firstEl.focus()
			}
		}

		window.addEventListener("keydown", onKey, true)
		return () => {
			window.removeEventListener("keydown", onKey, true)
			document.body.style.overflow = prevOverflow
			restoreTo.current?.focus?.()
		}
	}, [open, close])

	useEffect(() => {
		body.current?.scrollTo({ top: 0 })
	}, [scrollKey])

	if (!open || !isClient) return null

	const width = { lg: "max-w-[880px]", md: "max-w-[720px]", xl: "max-w-[1020px]" }[size]

	// Straight onto the body: several callers sit inside sticky panels, and a sticky ancestor is its own stacking context that a z-index cannot escape.
	return createPortal(
		<div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6">
			<div
				aria-hidden="true"
				className="absolute inset-0 bg-navy/45 backdrop-blur-[3px] motion-safe:animate-[hl-pop_.3s_ease-out]"
				onClick={close}
			/>

			<div
				// If no ModalTitle rendered, `titleId` points at nothing: AT ignores the dangling reference and falls back to this label, so a forgotten title no longer means an unnamed dialog.
				aria-label={labelledBy ? undefined : typeof eyebrow === "string" && eyebrow ? eyebrow : "Dialog"}
				aria-labelledby={labelledBy ?? titleId}
				aria-modal="true"
				className={cx(
					"sketch sketch-2 relative flex max-h-[92dvh] w-full flex-col bg-cream outline-none motion-safe:animate-[hl-rise_.42s_cubic-bezier(.16,1,.3,1)]",
					"rounded-t-3xl sm:rounded-3xl",
					width,
				)}
				ref={ref}
				role="dialog"
				style={{ "--sk-color": accent, "--sk-radius": "26px" } as React.CSSProperties}
				tabIndex={-1}
			>
				<div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4 sm:px-8 sm:pt-6">
					<span className="label pt-1" style={{ color: accentText(accent) }}>
						{eyebrow}
					</span>
					{dismissible && (
						<button
							aria-label="Close"
							className="sketch grid size-8 shrink-0 place-items-center rounded-lg text-navy-soft transition-colors hover:bg-white hover:text-navy"
							onClick={onClose}
							style={{ "--sk-radius": "9px" } as React.CSSProperties}
							type="button"
						>
							<IconX className="text-base" />
						</button>
					)}
				</div>

				<div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-6 sm:px-8 sm:pt-5" ref={body}>
					<ModalTitleId.Provider value={titleId}>{children}</ModalTitleId.Provider>
				</div>

				{footer && (
					<div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-dashed border-line/80 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-5">
						{footer}
					</div>
				)}
			</div>
		</div>,
		document.body,
	)
}

export function ModalTitle({
	children,
	id,
	sub,
	subWide = false,
}: {
	children: ReactNode
	id?: string
	sub?: ReactNode
	/**
	 * Let the subtitle run the whole content width instead of holding a reading measure. For a wide modal whose body is a full-width grid, the capped line stops halfway and reads as a ragged column the grid below does not share; a sentence short enough to stay near one line would rather square up with it. Long copy still wants the cap – that is why this is opt-in.
	 */
	subWide?: boolean
}) {
	// A title with no explicit id takes the dialog's own, so the dialog always has something to be labelled by; callers that wire `id` + `labelledBy` themselves keep doing so.
	const dialogTitleId = useContext(ModalTitleId)
	return (
		<div className="mb-5">
			<h2
				className="text-[1.5rem] leading-tight font-extrabold tracking-[-0.02em] text-navy sm:text-[1.85rem]"
				id={id ?? dialogTitleId}
			>
				{children}
			</h2>
			{sub && (
				<p className={cx("mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft", !subWide && "max-w-[62ch]")}>{sub}</p>
			)}
		</div>
	)
}
