"use client"

import Image from "next/image"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { Avatar } from "@/components/platform/Avatar"
import { IconClock, IconLogout } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { signOut } from "@/lib/auth-client"
import { cx } from "@/lib/cx"
import { fmtHours } from "@/lib/projects"
import { PLATFORM_HOME } from "@/lib/routes"
import { useStore } from "@/lib/store"
import logoArt from "../../../../public/art/logo.png"
import { GoalTracker } from "./GoalTracker"

export const NAV = [
	{ href: PLATFORM_HOME, label: "Home", tourId: "nav-home" },
	{ href: "/doomscroller", label: "Doomscroller", tourId: "nav-doomscroller" },
	{ href: "/projects", label: "Projects", tourId: "nav-projects" },
	{ href: "/reels", label: "My Reels", tourId: "nav-reels" },
	{ href: "/explore", label: "Explore", tourId: "nav-explore" },
	{ href: "/shop", label: "Shop", tourId: "nav-shop" },
	{ href: "/docs", label: "Docs", tourId: "nav-docs" },
] as const

/**
 * The phone tab bar divides into equal cells, six at most: six 60px cells is what a 360px screen holds with the uppercase labels still readable. The Doomscroller gets in through the header link below lg instead of taking one.
 */
export const TAB_NAV = NAV.filter(item => item.href !== "/doomscroller")

export function Sidebar({ className }: { className?: string }) {
	const pathname = usePathname()
	const { reset, viewer } = useStore()
	const [signingOut, setSigningOut] = useState(false)

	return (
		<div className={cx("flex flex-col gap-5", className)}>
			{/* The same artwork the landing page leads with, so the platform reads as the place the site sent you. Sized to the rail, not to its own pixels: the file is drawn large, and priority because it is above the fold on every page. */}
			<Link
				aria-label="Half Life home"
				className="block w-44 shrink-0 transition-transform duration-150 hover:-translate-y-0.5 active:translate-y-px xl:w-50"
				href={PLATFORM_HOME}
			>
				<Image
					alt=""
					className="h-auto w-full drop-shadow-[0_3px_6px_rgb(28_26_89/0.18)]"
					priority
					sizes="200px"
					src={logoArt}
				/>
			</Link>

			<Panel className="relative bg-cream/60 pt-7 pb-5" radius={18} tone="line">
				<span aria-hidden="true" className="torn-soft absolute -top-3.5 left-8 h-8 w-20 rounded-t-lg bg-coral" />
				<nav className="relative px-5">
					<ul>
						{NAV.map(item => {
							const active = item.href === PLATFORM_HOME ? pathname === PLATFORM_HOME : pathname.startsWith(item.href)
							return (
								<li className="relative" data-tour={item.tourId} key={item.href}>
									<Link
										aria-current={active ? "page" : undefined}
										className={cx(
											"group flex items-center justify-between gap-2 border-b border-dashed border-line py-3 text-[1.02rem] transition-[color,transform] duration-150 active:translate-y-px",
											active ? "font-extrabold text-navy" : "font-semibold text-navy-soft hover:text-navy",
										)}
										href={item.href}
									>
										<span className="truncate">{item.label}</span>
										{active && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-coral" />}
									</Link>
								</li>
							)
						})}
					</ul>
				</nav>
			</Panel>

			{/* From xl up the goal rides the status rail on the right, where the Doomscroller lives. Below that there is no second rail, so it stays here – one instance is on screen at a time either way. */}
			<GoalTracker className="xl:hidden" />

			{/* The one number that only grows, kept above the account card. */}
			<TimeLogged />

			<Panel className="flex items-center gap-3.5 bg-cream/60 p-3.5" radius={18} tone="line">
				<Link
					aria-label={`${viewer.name}'s profile`}
					className="shrink-0 rounded-lg transition-transform hover:-translate-y-0.5 active:translate-y-px"
					href={`/u/${viewer.id}`}
				>
					<Avatar className="size-[66px] text-[1.6rem]" image={viewer.image} name={viewer.name} shape="tile" />
				</Link>
				<div className="min-w-0">
					<Link
						className="block truncate text-[1rem] leading-tight font-extrabold text-navy transition-colors hover:text-violet-deep hover:underline hover:decoration-dashed hover:underline-offset-4"
						href={`/u/${viewer.id}`}
					>
						{viewer.name}
					</Link>
					<button
						className="label mt-2 inline-flex items-center gap-1.5 text-sky-ink transition-colors hover:text-coral-deep"
						disabled={signingOut}
						onClick={async () => {
							setSigningOut(true)
							try {
								await signOut()
								// A full document load across the two root layouts: a client navigation can leave the
								// landing stylesheet in front of the platform's, painting the trail in the wrong world.
								window.location.assign("/")
							} finally {
								setSigningOut(false)
							}
						}}
						type="button"
					>
						{signingOut ? "Signing out…" : "Log out"} <IconLogout className="text-[0.95rem]" />
					</button>
				</div>
			</Panel>

			<button
				className="hand -mt-1 self-start text-[0.76rem] text-navy-faint underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
				onClick={reset}
				type="button"
			>
				Replay the intro
			</button>

			{viewer.isAdmin && <RedoOnboarding />}
			{viewer.isAdmin && <BypassLocks />}
		</div>
	)
}

/**
 * How much time is on the record, journalled and tracked.
 *
 * Hidden entirely at zero. An empty account gets no "0h" card, because a counter sitting at zero is a scold rather than a fact; the moment there is any time at all it appears above the account card and stays.
 */
function TimeLogged() {
	const { totalHours } = useStore()
	if (totalHours <= 0) return null

	return (
		<Panel className="bg-cream/60 px-5 py-4" radius={18} tone="line">
			<p className="label text-violet-deep">Time logged</p>
			<p className="mt-2 flex items-baseline gap-2">
				<IconClock className="translate-y-0.5 text-[1.15rem] text-teal-ink" />
				<span className="text-[1.5rem] leading-none font-extrabold tabular-nums text-navy">{fmtHours(totalHours)}</span>
			</p>
			<p className="hand mt-1.5 text-[0.78rem] leading-snug text-navy-soft">
				journalled and tracked across your projects
			</p>
		</Panel>
	)
}

/**
 * Admins only: open every checkpoint on the trail, whatever its order, hours or dates say, for walking the flow. It only opens nodes – whatever is saved from one still goes through the server's own checks.
 */
function BypassLocks() {
	const { bypassLocks, setBypassLocks } = useStore()

	return (
		<button
			aria-pressed={bypassLocks}
			className={cx(
				"hand -mt-3 self-start text-[0.76rem] underline decoration-dashed underline-offset-4 transition-colors",
				bypassLocks ? "font-semibold text-coral-dark hover:text-navy" : "text-navy-faint hover:text-navy",
			)}
			onClick={() => setBypassLocks(!bypassLocks)}
			type="button"
		>
			{bypassLocks ? "Relock checkpoints" : "Bypass checkpoint locks"}{" "}
			<span className="label ml-1 text-[0.6rem] no-underline">admin</span>
		</button>
	)
}

/**
 * Admins only: the whole first run again, setup questions included, as a new participant would see it. It wipes this admin's own answers, so it asks once, inline rather than in a browser dialog.
 */
function RedoOnboarding() {
	const { redoOnboarding } = useStore()
	const [asking, setAsking] = useState(false)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const link =
		"hand text-[0.76rem] underline decoration-dashed underline-offset-4 transition-colors disabled:opacity-60"

	if (!asking)
		return (
			<button
				className={cx(link, "-mt-3 self-start text-navy-faint hover:text-navy")}
				onClick={() => setAsking(true)}
				type="button"
			>
				Redo onboarding <span className="label ml-1 text-[0.6rem] no-underline">admin</span>
			</button>
		)

	return (
		<div className="-mt-2 rounded-xl border-2 border-dashed border-line px-3.5 py-3">
			<p className="text-[0.8rem] leading-snug text-navy-soft">
				This clears your setup answers and starts the first run over, questions included. Your projects and entries
				stay.
			</p>
			{error && (
				<p className="mt-2 text-[0.78rem] font-semibold text-coral-dark" role="alert">
					{error}
				</p>
			)}
			<div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
				<button
					className={cx(link, "font-semibold text-coral-dark hover:text-navy")}
					disabled={busy}
					onClick={async () => {
						setBusy(true)
						setError(null)
						const failed = await redoOnboarding()
						setBusy(false)
						if (failed) setError(failed)
						else setAsking(false)
					}}
					type="button"
				>
					{busy ? "Resetting…" : "Yes, redo it"}
				</button>
				<button
					className={cx(link, "text-navy-faint hover:text-navy")}
					disabled={busy}
					onClick={() => {
						setAsking(false)
						setError(null)
					}}
					type="button"
				>
					Cancel
				</button>
			</div>
		</div>
	)
}
