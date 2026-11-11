"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { ShipTable } from "@/components/review/ShipTable"
import { PageHead, Paper } from "@/components/review/ui"
import type { ReviewQueue, ReviewStatus } from "@/lib/review-platform/types"

interface Filters {
	kind: "" | "design" | "build"
	mine: boolean
	status: ReviewStatus
}

const STATUSES: readonly ReviewStatus[] = Object.freeze(["pending", "approved", "returned", "rejected"])
const KINDS: readonly Filters["kind"][] = Object.freeze(["", "design", "build"])

const queueHref = (filters: Filters, cursor?: string | null): string => {
	const params = new URLSearchParams()
	if (filters.status !== "pending") params.set("status", filters.status)
	if (filters.kind) params.set("kind", filters.kind)
	if (filters.mine) params.set("mine", "1")
	if (cursor) params.set("cursor", cursor)
	const query = params.toString()
	return query ? `/reviews?${query}` : "/reviews"
}

/**
 * Fabricate's review queue: status tabs with counts, a kind filter, "claimed by me", and a table that refreshes every fifteen seconds so claims and new hand-ins show up without a reload.
 *
 * Fabricate's reviewer pledge card is not here – Half Life has no pledges.
 */
export function QueueView({ filters, queue }: { filters: Filters; queue: ReviewQueue }) {
	const router = useRouter()

	useEffect(() => {
		const id = window.setInterval(() => {
			if (document.visibilityState === "visible") router.refresh()
		}, 15_000)
		return () => window.clearInterval(id)
	}, [router])

	const set = (patch: Partial<Filters>): void => router.push(queueHref({ ...filters, ...patch }))

	return (
		<>
			<PageHead eyebrow="Ships" title="Review queue" />
			<div className="form__actions" style={{ marginBottom: "var(--space-2)" }}>
				<div className="tabs" style={{ border: 0, margin: 0 }}>
					{STATUSES.map(status => (
						<button
							className={filters.status === status ? "tabs__tab is-active" : "tabs__tab"}
							key={status}
							onClick={() => set({ status })}
							type="button"
						>
							{status} ({queue.counts[status] ?? 0})
						</button>
					))}
				</div>
				<div className="tabs" style={{ border: 0, margin: 0 }}>
					{KINDS.map(kind => (
						<button
							className={filters.kind === kind ? "tabs__tab is-active" : "tabs__tab"}
							key={kind || "all"}
							onClick={() => set({ kind })}
							type="button"
						>
							{kind || "all kinds"}
						</button>
					))}
				</div>
				<label className="tabs__tab" style={{ alignItems: "center", display: "inline-flex", gap: "0.4em" }}>
					<input checked={filters.mine} onChange={e => set({ mine: e.target.checked })} type="checkbox" /> claimed by me
				</label>
			</div>
			<Paper variant="tight">
				<ShipTable rows={queue.rows} />
			</Paper>
			{queue.previous !== null || queue.next !== null ? (
				<nav aria-label="Pages" className="review-pager">
					{queue.previous !== null ? (
						<Link className="btn btn--ghost btn--sm" href={queueHref(filters, queue.previous)}>
							← Newer
						</Link>
					) : null}
					{queue.next !== null ? (
						<Link className="btn btn--ghost btn--sm" href={queueHref(filters, queue.next)}>
							Older →
						</Link>
					) : null}
				</nav>
			) : null}
		</>
	)
}
