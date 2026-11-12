"use client"

import Image from "next/image"
import Link from "next/link"
import { useRef, useState } from "react"
import { PrinterPhoto } from "@/components/platform/art"
import { NAV } from "@/components/platform/shell/Sidebar"
import { toggleRail, useRailCollapse, useRailHidden } from "@/components/review/rail"
import { Icon } from "@/components/review/ui"
import { HardLink } from "@/components/site/HardLink"
import { signOut } from "@/lib/auth-client"
import { printerById } from "@/lib/config/printers"
import { ParticipantGoal } from "@/lib/enums"
import { fmtHours } from "@/lib/numbers"
import { PLATFORM_HOME } from "@/lib/routes"
import { useStore } from "@/lib/store"
import logoArt from "../../../public/art/logo.png"

/**
 * Half Life's sidebar as the review platform draws it: the platform `Sidebar`'s blocks in the same order (the logo, the nav with Review among it, the goal, the time on record and the account), built from Fabricate's rail rather than the platform's paper. It is the `docs-rail` Fabricate's `SiteRail` is, so it folds into a top bar and drawer at narrow widths and can be hidden on a desktop the same way.
 *
 * Everything but Review is in the platform, another root layout, so those links are `HardLink`s. The goal is shown rather than changed here: its picker is a platform modal, so "Change goal" goes to the dashboard, where the platform's own tracker opens it.
 */
export function ReviewSidebar({ admin }: { admin: boolean }) {
	const nav = useRef<HTMLDetailsElement>(null)
	useRailCollapse(nav)

	return (
		<aside className="docs-rail">
			<HardLink aria-label="Half Life home" className="docs-logo review-logo" href={PLATFORM_HOME}>
				<Image alt="" priority sizes="176px" src={logoArt} />
			</HardLink>

			<details className="docs-nav" open ref={nav}>
				<summary>
					<span className="visually-hidden">Menu</span>
				</summary>
				<nav aria-label="Primary">
					<ul className="docs-groups">
						{NAV.map(item => (
							<li className="docs-group" key={item.href}>
								<HardLink className="docs-group__title" href={item.href}>
									{item.label}
								</HardLink>
							</li>
						))}
						{/* Every route in this document is the review platform, so Review is always the current page. */}
						<li className="docs-group is-active">
							<Link aria-current="page" className="docs-group__title" href="/reviews">
								Review
							</Link>
						</li>
						{admin ? (
							<li className="docs-group">
								<HardLink className="docs-group__title" href="/admin">
									Admin
								</HardLink>
							</li>
						) : null}
					</ul>
				</nav>

				<div className="review-rail__boxes">
					<RailGoal />
					<RailTime />
				</div>

				<RailAccount />
			</details>
		</aside>
	)
}

/** The platform's goal tracker, read-only: the machine and the pace to it, or the coins for someone here for the funding. */
function RailGoal() {
	const { coins, goalId, participantGoal, printerFund } = useStore()
	const goal = printerById(goalId)
	// Null means the question has not been answered yet; like the platform's tracker, it shows the machine until it is.
	const chasing = participantGoal === null || participantGoal === ParticipantGoal.PRINTER
	const pct = goal.coins <= 0 ? 0 : Math.min(100, Math.round((printerFund / goal.coins) * 100))

	return (
		<section className="review-rail__box">
			<HardLink className="review-rail__label review-rail__label--link" href={PLATFORM_HOME}>
				Change goal
			</HardLink>
			{chasing ? (
				<>
					<div className="review-rail__goal">
						<p>
							On track to get a <span className="review-rail__strong">{goal.name}</span>
						</p>
						<PrinterPhoto className="review-rail__photo" id={goal.id} sizes="64px" />
					</div>
					<div
						aria-label={`${printerFund.toLocaleString()} / ${goal.coins.toLocaleString()}`}
						aria-valuemax={goal.coins}
						aria-valuemin={0}
						aria-valuenow={printerFund}
						className="review-rail__track"
						role="progressbar"
					>
						<span className="review-rail__bar" style={{ width: `${pct}%` }} />
					</div>
					<p className="review-rail__meta">
						{printerFund.toLocaleString()} / {goal.coins.toLocaleString()} coins
					</p>
				</>
			) : (
				<>
					<p>
						Here for the <span className="review-rail__strong">funding</span>
					</p>
					<p className="review-rail__meta">{coins.toLocaleString()} coins earned</p>
				</>
			)}
		</section>
	)
}

/** Time journalled and tracked. Hidden at zero, as on the platform. */
function RailTime() {
	const { totalHours } = useStore()
	if (totalHours <= 0) return null

	return (
		<section className="review-rail__box">
			<p className="review-rail__label">Time logged</p>
			<p className="review-rail__value">{fmtHours(totalHours)}</p>
			<p className="review-rail__meta">journalled and tracked across your projects</p>
		</section>
	)
}

/** Who is signed in, in Fabricate's rail foot: the face and name to the profile, then log out beside the toggle that hides the rail. */
function RailAccount() {
	const { coins, streak, viewer } = useStore()
	const [signingOut, setSigningOut] = useState(false)
	const initial = (viewer.name.trim()[0] ?? "?").toUpperCase()

	return (
		<div className="docs-rail__foot">
			<HardLink className="docs-rail__user" href={`/u/${viewer.id}`}>
				{viewer.image ? (
					// Avatars come from the identity provider's CDN.
					<img alt="" src={viewer.image} />
				) : (
					<span aria-hidden="true" className="review-rail__initial">
						{initial}
					</span>
				)}
				<span>
					<span className="docs-rail__name">{viewer.name}</span>
					<span className="docs-rail__meta">
						{coins.toLocaleString()} {coins === 1 ? "coin" : "coins"} · {streak}-day streak
					</span>
				</span>
			</HardLink>
			<div className="docs-rail__row">
				<button
					className="docs-rail__signout"
					disabled={signingOut}
					onClick={async () => {
						setSigningOut(true)
						try {
							await signOut()
							// A full document load: the landing page is another root layout.
							window.location.assign("/")
						} finally {
							setSigningOut(false)
						}
					}}
					type="button"
				>
					{signingOut ? "Signing out…" : "Log out ⎋"}
				</button>
				<RailToggle />
			</div>
		</div>
	)
}

/** Hides or brings back the rail on a desktop. The floating copy is the way back while it is hidden. */
export function RailToggle({ className }: { className?: string }) {
	const hidden = useRailHidden()

	return (
		<button
			aria-expanded={!hidden}
			aria-label={hidden ? "Show menu" : "Hide menu"}
			className={className ? `rail-toggle ${className}` : "rail-toggle"}
			onClick={toggleRail}
			title={hidden ? "Show menu (Shift+Q)" : "Hide menu (Shift+Q)"}
			type="button"
		>
			<Icon name={hidden ? "chevron-right" : "chevron-left"} />
		</button>
	)
}
