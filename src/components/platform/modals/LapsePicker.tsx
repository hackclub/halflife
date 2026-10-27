"use client"

import { useCallback, useEffect, useState } from "react"
import { IconArrowRight, IconCheck, IconClock, IconFilm, IconWarning } from "@/components/platform/icons"
import { Button, Chip } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import { messageOf } from "@/lib/errors"
import { type LapseTimelapse, readLapsePage } from "@/lib/lapse-timelapses"

type Load =
	| { state: "loading" }
	| { state: "unlinked" }
	| { state: "error"; message: string }
	| { state: "ready"; items: LapseTimelapse[]; nextCursor: string | null }

const LAPSE_URL = "https://lapse.hackclub.com"

/** Recorded time, the way a person says it: 45m, 1h 20m, 2h. */
export function fmtDuration(seconds: number) {
	const m = Math.round(seconds / 60)
	if (m < 60) return `${m}m`
	const h = Math.floor(m / 60)
	return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

async function fetchPage(cursor?: string, forSession?: string) {
	const query = new URLSearchParams({
		...(cursor ? { cursor } : {}),
		...(forSession ? { forSession } : {}),
	})
	const res = await fetch(`/api/lapse/timelapses?${query}`, { cache: "no-store" })
	// The body is read as an unknown answer first: a refusal carries `{ error }` and none of the page's fields, so reading it against the page shape is what used to lose both its message and its code.
	const read = readLapsePage(res.status, await res.json().catch(() => null))
	if ("error" in read) throw new Error(read.error)
	if ("unlinked" in read) return { unlinked: true as const }
	return read.page
}

/**
 * Pick the Lapse timelapses that back this entry.
 *
 * Timelapses are recorded on Lapse, not here. This lists what the maker has published there and lets them tick the ones for this session. A timelapse is offered only once it is finished and not already claimed by another entry – one recording backs one session, and the server holds to both rules whatever this shows.
 */
export function LapsePicker({
	picked,
	onToggle,
	onSignIn,
	forSession,
}: {
	picked: LapseTimelapse[]
	onToggle(t: LapseTimelapse): void
	/** Leaves the page for Lapse; the caller stashes the draft first. */
	onSignIn(): void | Promise<void>
	/**
	 * The entry being edited, so its own clips read as free: taking one off and putting it back on stays pickable instead of reading as claimed.
	 */
	forSession?: string
}) {
	const [load, setLoad] = useState<Load>({ state: "loading" })
	const [more, setMore] = useState(false)
	const [leaving, setLeaving] = useState(false)
	const [signInError, setSignInError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoad({ state: "loading" })
		try {
			const page = await fetchPage(undefined, forSession)
			if ("unlinked" in page) setLoad({ state: "unlinked" })
			else setLoad({ items: page.timelapses, nextCursor: page.nextCursor, state: "ready" })
		} catch (err) {
			setLoad({ message: messageOf(err), state: "error" })
		}
	}, [forSession])

	useEffect(() => {
		// fetching on mount
		void refresh()
	}, [refresh])

	async function loadMore() {
		if (load.state !== "ready" || !load.nextCursor) return
		setMore(true)
		try {
			const page = await fetchPage(load.nextCursor, forSession)
			if ("unlinked" in page) setLoad({ state: "unlinked" })
			else
				setLoad({
					items: [...load.items, ...page.timelapses],
					nextCursor: page.nextCursor,
					state: "ready",
				})
		} catch (err) {
			setLoad({ message: messageOf(err), state: "error" })
		} finally {
			setMore(false)
		}
	}

	async function startSignIn() {
		setLeaving(true)
		setSignInError(null)
		try {
			await onSignIn()
		} catch (err) {
			setSignInError(err instanceof Error ? err.message : "Could not start Lapse sign-in")
			setLeaving(false)
		}
	}

	if (load.state === "loading")
		return (
			<p aria-live="polite" className="hand py-10 text-center text-[0.9rem] text-navy-soft">
				looking for your timelapses on Lapse…
			</p>
		)

	if (load.state === "unlinked")
		return (
			<div
				className="sketch grid justify-items-center gap-3 rounded-2xl bg-violet-pale px-6 py-8 text-center"
				style={{ "--sk-color": "var(--color-violet)", "--sk-radius": "18px" }}
			>
				<span className="grid size-12 place-items-center rounded-full bg-violet text-white">
					<IconFilm className="text-xl" />
				</span>
				{signInError ? (
					<p className="max-w-[46ch] text-[0.84rem] font-semibold text-coral-deep" role="alert">
						{signInError}
					</p>
				) : null}
				<p className="max-w-[40ch] text-[0.92rem] leading-snug text-navy">
					Timelapses are recorded on Lapse. Sign in once and every timelapse you publish there shows up here to pick
					from.
				</p>
				<Button disabled={leaving} onClick={() => startSignIn()} variant="solid">
					{leaving ? "Opening Lapse…" : "Sign in with Lapse"} <IconArrowRight className="text-base" />
				</Button>
				<p className="hand text-[0.78rem] text-navy-soft">
					you&apos;ll come straight back here, with your entry as you left it.
				</p>
			</div>
		)

	if (load.state === "error")
		return (
			<div className="grid justify-items-center gap-3 py-8 text-center">
				<p className="flex items-start gap-2 text-[0.88rem] font-semibold text-coral-deep" role="alert">
					<IconWarning className="mt-0.5 shrink-0 text-base" /> {load.message}
				</p>
				<Button onClick={() => refresh()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		)

	const pickedIds = new Set(picked.map(p => p.id))

	return (
		<div>
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<a
					className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
					href={`${LAPSE_URL}/timelapse/create`}
					rel="noreferrer"
					target="_blank"
				>
					record a new one on Lapse
				</a>
				<Button onClick={() => refresh()} size="sm" variant="ghost">
					Refresh
				</Button>
			</div>

			{load.items.length === 0 ? (
				<div className="sketch rounded-2xl bg-white px-6 py-9 text-center" style={{ "--sk-radius": "18px" }}>
					<p className="font-bold text-navy">No published timelapses yet</p>
					<p className="mx-auto mt-1.5 max-w-[42ch] text-[0.85rem] leading-snug text-navy-soft">
						Record your session on Lapse, publish it as public or unlisted, then hit refresh.
					</p>
				</div>
			) : (
				<ul className="grid gap-2.5 sm:grid-cols-2">
					{load.items.map(t => {
						const selected = pickedIds.has(t.id)
						const blocked = !selected && (t.processing || t.attached || t.visibility === "FAILED_PROCESSING")
						const why = t.attached
							? "already added to project"
							: t.visibility === "FAILED_PROCESSING"
								? "failed processing on Lapse"
								: t.processing
									? "still processing on Lapse"
									: null
						return (
							<li className="flex flex-col" key={t.id}>
								<button
									aria-pressed={selected}
									className={cx(
										"sketch group flex w-full flex-1 items-center gap-3 rounded-2xl p-2.5 text-left transition-[background-color,transform] duration-150",
										selected ? "bg-violet-pale" : "bg-white",
										blocked ? "cursor-not-allowed opacity-60" : "active:translate-y-px",
										!selected && !blocked && "hover:bg-cream",
									)}
									disabled={blocked}
									onClick={() => onToggle(t)}
									style={{
										"--sk-color": selected ? "var(--color-violet)" : undefined,
										"--sk-radius": "16px",
									}}
									type="button"
								>
									<span className="relative grid aspect-video w-24 shrink-0 place-items-center overflow-hidden rounded-lg bg-navy/10">
										{t.thumbnailUrl ? (
											// Lapse's CDN, sized by the box; next/image would need every Lapse host allow-listed for no gain at 96px.
											<img alt="" className="h-full w-full object-cover" loading="lazy" src={t.thumbnailUrl} />
										) : (
											<IconFilm className="text-lg text-navy-soft" />
										)}
										{selected && (
											<span className="absolute inset-0 grid place-items-center bg-violet/70 text-white">
												<IconCheck className="text-xl" strokeWidth={3.4} />
											</span>
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-[0.9rem] font-bold text-navy">
											{t.title || "Untitled timelapse"}
										</span>
										<span className="hand mt-0.5 flex flex-wrap items-center gap-x-2 text-[0.78rem] text-navy-soft tabular-nums">
											<span className="inline-flex items-center gap-1 text-teal-ink">
												<IconClock className="text-xs" /> {fmtDuration(t.durationSeconds)}
											</span>
											<span>
												{new Date(t.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
											</span>
											{t.visibility === "UNLISTED" && <span>unlisted</span>}
										</span>
										{why ? (
											<span className="hand mt-0.5 block text-[0.74rem] text-coral-deep">{why}</span>
										) : t.hackatimeProject ? (
											<Chip className="mt-1 max-w-full truncate" tone="muted">
												{t.hackatimeProject}
											</Chip>
										) : null}
									</span>
								</button>
							</li>
						)
					})}
				</ul>
			)}

			{load.nextCursor && (
				<div className="mt-3 flex justify-center">
					<Button disabled={more} onClick={() => loadMore()} size="sm" variant="outline">
						{more ? "Loading…" : "Show older timelapses"}
					</Button>
				</div>
			)}
		</div>
	)
}
