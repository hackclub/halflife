"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { HardLink } from "@/components/site/HardLink"

/**
 * The review platform's left rail, in the shape of Fabricate's `SiteRail` for staff: the lockup, a column of boxed links, and who is signed in.
 *
 * Links back into Half Life go through `HardLink`: the console and the trail are other root layouts, and crossing worlds has to be a full page load.
 */
export function ReviewRail({ admin, name }: { admin: boolean; name: string }) {
	const path = usePathname()
	const queueActive = path === "/reviews" || path.startsWith("/reviews/")
	return (
		<aside className="docs-rail">
			<Link className="docs-logo review-wordmark" href="/reviews">
				Half Life <span>reviews</span>
			</Link>
			<details className="docs-nav" open>
				<summary>
					<span className="visually-hidden">Menu</span>
				</summary>
				<nav aria-label="Primary">
					<ul className="docs-groups">
						<li className={queueActive ? "docs-group is-active" : "docs-group"}>
							<Link className="docs-group__title" href="/reviews">
								Review queue
							</Link>
						</li>
						{admin ? (
							<li className="docs-group">
								<HardLink className="docs-group__title" href="/admin">
									Admin
								</HardLink>
							</li>
						) : null}
						<li className="docs-group">
							<HardLink className="docs-group__title" href="/dashboard">
								Dashboard
							</HardLink>
						</li>
					</ul>
				</nav>
				<div className="docs-rail__foot">
					<span className="docs-rail__user">
						<span>
							<span className="docs-rail__name">{name}</span>
							<span className="docs-rail__meta">Reviewing</span>
						</span>
					</span>
				</div>
			</details>
		</aside>
	)
}
