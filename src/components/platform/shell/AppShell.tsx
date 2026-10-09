"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useState } from "react"
import {
	IconBag,
	IconBook,
	IconChevronLeft,
	IconChevronRight,
	IconCoin,
	IconCompass,
	IconFilm,
	IconFlame,
	IconHome,
	IconPencil,
	IconTrophy,
} from "@/components/platform/icons"
import { GoalModal } from "@/components/platform/modals/GoalModal"
import { Overlays } from "@/components/platform/onboarding/Overlays"
import { EventScheduleButton } from "@/components/platform/shell/EventScheduleButton"
import { cx } from "@/lib/cx"
import type { CalendarEvent } from "@/lib/events"
import { PLATFORM_HOME } from "@/lib/routes"
import { useStore } from "@/lib/store"
import logoArt from "../../../../public/art/logo.png"
import { DoomscrollerFeed } from "./Doomscroller"
import { GoalTracker } from "./GoalTracker"
import { Sidebar, TAB_NAV } from "./Sidebar"

const MOBILE_ICONS = {
	[PLATFORM_HOME]: IconHome,
	"/projects": IconPencil,
	"/explore": IconCompass,
	"/shop": IconBag,
	"/docs": IconBook,
	"/reels": IconFilm,
} as const

/**
 * How much of the page's scroll the doodle backdrop absorbs. 0 is the fixed backdrop it used to be; 1 would scroll with the page. A third reads as a slow drift – the paper lags the trail without ever looking detached from it.
 */
const BACKDROP_PARALLAX = 0.35

function StatCluster() {
	const { coins, streak } = useStore()
	return (
		<div className="flex shrink-0 items-center gap-2.5 sm:gap-6">
			<span className="flex items-center gap-1 sm:gap-1.5" title={`${coins} coins banked`}>
				<IconCoin className="text-[1.3rem] text-orange sm:text-[1.45rem]" />
				<span className="text-[1.05rem] leading-none font-extrabold tabular-nums text-orange-ink sm:text-[1.15rem]">
					{coins}
				</span>
				<span className="sr-only">coins</span>
			</span>
			<span className="flex items-center gap-1 sm:gap-1.5" title={`${streak} day streak`}>
				<IconFlame className="text-[1.3rem] text-coral sm:text-[1.45rem]" />
				<span className="text-[1.05rem] leading-none font-extrabold tabular-nums text-coral-deep sm:text-[1.15rem]">
					{streak}
				</span>
				<span className="sr-only">day streak</span>
			</span>
		</div>
	)
}

export function AppShell({
	children,
	events,
	programTimezone,
}: {
	children: React.ReactNode
	/** Published events from now on, as the layout read them. */
	events: CalendarEvent[]
	/** The programme zone: the calendar's fallback until the browser's own zone loads. */
	programTimezone: string
}) {
	const pathname = usePathname()
	const { doomscrollerOpen, setDoomscroller, phase } = useStore()
	const backdropRef = useRef<HTMLDivElement>(null)

	const cinematic = phase === "cinematic"
	// The Doomscroller page is this feed at full size. Running the rail feed alongside it would put the same six reels on screen twice, so the route wins – without touching the reader's own open/closed preference.
	const onDoomscroller = pathname.startsWith("/doomscroller")

	// The status rail is the map's companion: open on the trail, where the goal is what the whole page is measured against, and folded away everywhere else so a project, the shop or the docs get the width. A toggle holds only for the page it was pressed on – the next page starts from its own default, so opening it once on the shop does not squeeze every page after.
	const [railChoice, setRailChoice] = useState<{ path: string; open: boolean } | null>(null)
	const railOpen = railChoice?.path === pathname ? railChoice.open : pathname === PLATFORM_HOME
	const setRailOpen = (open: boolean) => setRailChoice({ path: pathname, open })

	// Below lg the status rail is gone, so this is the only way to the goal tracker on a phone. It opens the same picker the rail's "View more" does.
	const [goalOpen, setGoalOpen] = useState(false)

	const rail = railOpen && doomscrollerOpen && !onDoomscroller

	// The shell's doodle backdrop drifts slower than the page: scroll writes a negative offset to --shell-parallax, which the backdrop's ::before reads as background-position. A plain listener rather than a requestAnimationFrame queue because scroll events are already frame-aligned and this only writes a variable – an rAF guard can wedge shut if a queued frame never runs (a backgrounded tab), leaving the backdrop stuck at its last offset. Skipped under prefers-reduced-motion, with the query watched so toggling the OS setting takes effect without a reload.
	useEffect(() => {
		const el = backdropRef.current
		if (!el) return
		const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")

		const paint = () => {
			el.style.setProperty("--shell-parallax", `${-window.scrollY * BACKDROP_PARALLAX}px`)
		}
		const sync = () => {
			window.removeEventListener("scroll", paint)
			if (reduce.matches) {
				el.style.removeProperty("--shell-parallax")
				return
			}
			paint()
			window.addEventListener("scroll", paint, { passive: true })
		}

		sync()
		reduce.addEventListener("change", sync)
		return () => {
			reduce.removeEventListener("change", sync)
			window.removeEventListener("scroll", paint)
		}
	}, [])

	return (
		<>
			<a
				href="#main"
				className="label sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[100] focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2.5 focus:text-white"
			>
				Skip to content
			</a>

			<div
				ref={backdropRef}
				className={cx(
					"shell-backdrop relative z-10 flex w-full transition-[filter,opacity] duration-500",
					cinematic && "pointer-events-none",
				)}
				aria-hidden={cinematic || undefined}
				inert={cinematic || undefined}
			>
				{/* ---------- left rail ---------- */}
				<aside className="sticky top-0 hidden h-dvh w-[246px] shrink-0 overflow-y-auto border-r border-dashed border-line bg-paper px-5 py-6 lg:block xl:w-[286px] xl:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<Sidebar />
				</aside>

				{/* ---------- centre + feed ---------- */}
				<div className="flex min-w-0 flex-1 flex-col">
					<header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-1.5 border-b border-dashed border-line/70 bg-cream/85 px-2 backdrop-blur-md sm:gap-3 sm:px-6 lg:border-b-0 lg:bg-transparent lg:backdrop-blur-none">
						{/* Only from sm: on a phone the wordmark is a smudge at any size that
                fits, and the row has a countdown, two shortcuts and two counters
                to hold. The bottom tab bar's Home is the brand anchor down there,
                and the left rail carries the full-size mark from lg. */}
						<Link
							href={PLATFORM_HOME}
							aria-label="Half Life home"
							className="hidden w-[64px] shrink-0 transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-px sm:block lg:hidden"
						>
							<Image src={logoArt} alt="" priority sizes="64px" className="h-auto w-full" />
						</Link>
						<div className="min-w-0 flex-1" />

						{/* Puts the rail back, under the product's own name for it. A
                second control labelled "Reels" would compete with the nav
                item while doing something different. */}
						{railOpen && !rail && !onDoomscroller && (
							<button
								type="button"
								onClick={() => setDoomscroller(true)}
								className="label hidden items-center gap-1.5 rounded-full border-2 border-line bg-paper px-3 py-1.5 text-navy-soft transition-colors hover:border-sky hover:text-navy xl:inline-flex"
							>
								<IconFilm className="text-base" /> Doomscroller
							</button>
						)}

						{/* Folds the whole status rail, goal and feed together. Named in
                full while it is folded, because then it is the only sign the
                goal exists on this page; an arrow once it is open, because the
                rail itself is showing what it hides. */}
						{railOpen ? (
							<button
								type="button"
								onClick={() => setRailOpen(false)}
								aria-expanded="true"
								aria-controls="status-rail"
								aria-label="Hide the goal and Doomscroller"
								title="Hide the goal and Doomscroller"
								className="hidden size-9 place-items-center rounded-full border-2 border-line bg-paper text-navy-soft transition-colors hover:border-violet hover:text-navy xl:grid"
							>
								<IconChevronRight className="text-base" />
							</button>
						) : (
							<button
								type="button"
								onClick={() => {
									setRailOpen(true)
									if (!onDoomscroller) setDoomscroller(true)
								}}
								aria-expanded="false"
								aria-controls="status-rail"
								className="label hidden items-center gap-1.5 rounded-full border-2 border-line bg-paper px-3 py-1.5 text-navy-soft transition-colors hover:border-violet hover:text-navy xl:inline-flex"
							>
								<IconChevronLeft className="text-base" /> Goal &amp; Doomscroller
							</button>
						)}

						{/* Below lg there is no sidebar, so this is the way to the page.
                The rail's goal tracker is out of reach there too, so this opens
                that picker here beside it – which asks what you're here for
                first, so it is named after the goal rather than the printer. Both
                fold to their icons on a phone: the logo, two full-width pills and
                the counters cannot share a 360px row. */}
						{!onDoomscroller && (
							<>
								<button
									type="button"
									onClick={() => setGoalOpen(true)}
									aria-haspopup="dialog"
									aria-label="Change goal"
									title="Change goal"
									className="label inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-line bg-paper px-2.5 py-1.5 text-navy-soft transition-colors hover:border-teal hover:text-navy sm:gap-1.5 lg:hidden"
								>
									<IconTrophy className="text-base" />
								</button>
								<Link
									href="/doomscroller"
									data-tour="doomscroller-button"
									aria-label="Doomscroller"
									title="Doomscroller"
									className="label inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-line bg-paper px-2.5 py-1.5 text-navy-soft transition-[color,border-color,transform] duration-150 hover:border-sky hover:text-navy active:translate-y-px sm:gap-1.5 lg:hidden"
								>
									<IconFilm className="text-base" />
								</Link>
							</>
						)}

						{/* The countdown to whatever is on the calendar next. Sits beside
                the counters rather than in the status rail, because it is the one
                header control that answers "what do I do next" rather than "what
                have I done" – and it is worth a glance on every page, not only on
                the trail. */}
						<EventScheduleButton events={events} timeZone={programTimezone} />

						<StatCluster />
					</header>

					<div className="flex min-w-0 flex-1">
						<main id="main" className="min-w-0 flex-1 pb-28 lg:pb-10">
							{children}
						</main>

						{/* The status rail. Open, its width is fixed so the trail down the
                middle never reflows underneath the reader while the feed inside
                opens and closes. Folded, it slides to nothing and the page takes
                the room; the content keeps its full width while it goes, so it
                is clipped away rather than squashed. */}
						<aside
							id="status-rail"
							inert={!railOpen}
							className={cx(
								"sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 justify-end overflow-hidden xl:flex",
								"transition-[width,opacity] duration-420 ease-out-expo motion-reduce:transition-none",
								railOpen ? "w-79 opacity-100 2xl:w-[352px]" : "w-0 opacity-0",
							)}
						>
							<div className="flex h-full w-full min-w-0 flex-col py-4 pr-5 pl-1 2xl:pr-7">
								<GoalTracker className="shrink-0" />

								{/* Stays mounted through the close so the feed slides shut
                    rather than vanishing – closing is often something the page
                    did, not something the reader asked for. */}
								<div
									data-tour={rail ? "doomscroller" : undefined}
									inert={!rail}
									className={cx(
										"flex min-h-0 overflow-hidden",
										"transition-[flex-grow,margin,opacity] duration-[420ms] ease-[cubic-bezier(.16,1,.3,1)]",
										rail ? "mt-4 flex-1 opacity-100" : "mt-0 flex-[0_1_0%] opacity-0",
									)}
								>
									{/* Not even mounted under the full-page player: hidden, its
                      cards would still fetch every reel's opening seconds a
                      second time for nobody to see. */}
									{!onDoomscroller && (
										<DoomscrollerFeed className="min-h-0 w-full" onClose={() => setDoomscroller(false)} />
									)}
								</div>
							</div>
						</aside>
					</div>
				</div>
			</div>

			{/* ---------- mobile tab bar ---------- */}
			<nav
				aria-label="Primary"
				className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-cream/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
			>
				<ul className="mx-auto flex max-w-lg">
					{TAB_NAV.map((item) => {
						const Icon = MOBILE_ICONS[item.href as keyof typeof MOBILE_ICONS]
						const active = item.href === PLATFORM_HOME ? pathname === PLATFORM_HOME : pathname.startsWith(item.href)
						return (
							<li key={item.href} data-tour={item.tourId} className="min-w-0 flex-1">
								<Link
									href={item.href}
									aria-current={active ? "page" : undefined}
									className={cx(
										"flex flex-col items-center gap-1 py-2.5 transition-[color,transform] duration-150 active:translate-y-px",
										active ? "text-navy" : "text-navy-soft hover:text-navy",
									)}
								>
									<Icon className="text-[1.45rem]" />
									<span className="label w-full truncate text-center text-[0.6rem] tracking-[0.06em]">
										{item.label}
									</span>
									<span
										aria-hidden="true"
										className={cx("h-1 w-6 rounded-full transition-colors", active ? "bg-coral" : "bg-transparent")}
									/>
								</Link>
							</li>
						)
					})}
				</ul>
			</nav>

			<Overlays />
			<GoalModal open={goalOpen} onClose={() => setGoalOpen(false)} />
		</>
	)
}
