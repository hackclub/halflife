"use client"

import type { ReactNode } from "react"
import { RailToggle, ReviewSidebar } from "@/components/review/ReviewSidebar"
import { useRailToggle } from "@/components/review/rail"

/**
 * The review platform's page shell, after Fabricate's `AppLayout` for its admin pages: the rail beside the main column, and with the rail hidden (its foot toggle, or Shift+Q) the column takes the whole width and a floating toggle at the bottom left brings the rail back.
 */
export function ReviewShell({ admin, children }: { admin: boolean; children: ReactNode }) {
	const railHidden = useRailToggle()

	return (
		<div className={railHidden ? "app-shell app-shell--admin is-rail-hidden" : "app-shell app-shell--admin"}>
			<a className="skip-link" href="#app-main">
				Skip to content
			</a>
			<ReviewSidebar admin={admin} />
			{railHidden ? <RailToggle className="rail-toggle--float" /> : null}
			<main className="app-main" id="app-main">
				{children}
			</main>
		</div>
	)
}
