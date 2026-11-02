"use client"

import { Panel } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import type { FeedItem } from "@/lib/feed"
import { ReelComments } from "./ReelComments"

/**
 * The conversation, in its two homes: a column beside the reel when there is room, and a sheet over it otherwise.
 *
 * Only one is ever mounted, so only one ever fetches. The sheet stays mounted through its slide down, so it does not empty as it goes.
 */
export function ReelCommentsPanel({
	beside,
	current,
	onBesideClose,
	onPatch,
	onSheetClose,
	onSheetExited,
	sheetOpen,
	sheetShown,
	viewer,
}: {
	beside: boolean
	current: FeedItem | undefined
	onBesideClose(): void
	onPatch(id: string, next: Partial<FeedItem>): void
	onSheetClose(): void
	/** Called once the sheet has finished sliding away, so it can be unmounted empty. */
	onSheetExited(): void
	sheetOpen: boolean
	sheetShown: boolean
	viewer: { image: string | null; name: string }
}) {
	return (
		<>
			{/* ---------- the conversation, beside the reel ---------- */}
			{beside && (
				<Panel as="aside" className="my-3 flex w-84 shrink-0 flex-col bg-paper 2xl:w-96" radius={18} tone="line">
					<ReelComments
						className="h-full w-full"
						onClose={onBesideClose}
						onPatch={onPatch}
						reel={current ?? null}
						viewer={viewer}
					/>
				</Panel>
			)}

			{/* ---------- the conversation, over it ---------- */}
			<div className={cx("fixed inset-0 z-[60]", !sheetOpen && "pointer-events-none")} inert={!sheetOpen}>
				<div
					aria-hidden="true"
					className={cx(
						"absolute inset-0 bg-navy/30 backdrop-blur-[2px] transition-opacity duration-300",
						sheetOpen ? "opacity-100" : "opacity-0",
					)}
					onClick={onSheetClose}
				/>
				{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: the role is conditional, and aria-modal is only ever rendered alongside it. */}
				<div
					aria-label="Comments"
					aria-modal={sheetOpen ? true : undefined}
					className={cx(
						"sketch absolute inset-x-0 bottom-0 flex h-[72dvh] flex-col rounded-t-3xl bg-cream",
						"transition-transform duration-[380ms] ease-[cubic-bezier(.16,1,.3,1)] motion-reduce:transition-none",
						"md:inset-x-auto md:right-6 md:bottom-6 md:h-[min(42rem,calc(100dvh-3rem))] md:w-96 md:rounded-3xl",
						sheetOpen ? "translate-y-0" : "translate-y-[calc(100%+3rem)]",
					)}
					onTransitionEnd={e => {
						if (e.target === e.currentTarget && !sheetOpen) onSheetExited()
					}}
					role={sheetOpen ? "dialog" : undefined}
					style={{ "--sk-color": "var(--color-navy)", "--sk-radius": "24px" }}
				>
					<span aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line md:hidden" />
					{sheetShown && (
						<ReelComments
							className="min-h-0 flex-1"
							onClose={onSheetClose}
							onPatch={onPatch}
							reel={current ?? null}
							viewer={viewer}
						/>
					)}
				</div>
			</div>
		</>
	)
}
