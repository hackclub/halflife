"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Table } from "@/app/components/ui"

export type ExcludedReasonTone = "danger" | "info" | "muted" | "warning"

export interface ExcludedGrantRow {
	/** The owner's account, so the row can link to it. Null for a project with no owner at all. */
	ownerId: string | null
	ownerName: string
	projectId: string
	reason: string
	title: string
	tone: ExcludedReasonTone
}

/** How many rows show before the reader reaches the end, and how many each step adds. */
const STEP = 50

/**
 * The projects left out of a card-grant batch, shown a screenful at a time. The list is the same shape as the user directory: the next rows come in as the bottom of the table scrolls into view, so a long exclusion list does not make the page a single tall column.
 */
export function ExcludedGrantList({ rows }: Readonly<{ rows: ExcludedGrantRow[] }>) {
	const [shown, setShown] = useState(STEP)
	const sentinel = useRef<HTMLDivElement>(null)
	const hasMore = shown < rows.length

	useEffect(() => {
		const element = sentinel.current
		if (!element || !hasMore) return
		const observer = new IntersectionObserver(
			entries => {
				if (entries.some(entry => entry.isIntersecting)) setShown(count => count + STEP)
			},
			{ rootMargin: "600px 0px" },
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [hasMore])

	return (
		<>
			<Table head={["Project", "Maker", "Reason"]}>
				{rows.slice(0, shown).map(row => (
					<tr key={row.projectId}>
						<td>
							<Link
								className="hl-entity-name"
								href={`/admin/users/${row.ownerId}?tab=projects#project-${row.projectId}`}
							>
								{row.title || "Untitled"}
							</Link>
							<div className="hl-entity-links">
								<Link href={`/projects/${row.projectId}`}>Public project</Link>
							</div>
							<div className="hl-hint hl-mono">{row.projectId}</div>
						</td>
						<td>
							{row.ownerId ? (
								<>
									<Link className="hl-entity-name" href={`/admin/users/${row.ownerId}`}>
										{row.ownerName}
									</Link>
									<div className="hl-entity-links">
										<Link href={`/u/${row.ownerId}`}>Public profile</Link>
									</div>
								</>
							) : (
								row.ownerName
							)}
						</td>
						<td className={`hl-reason--${row.tone}`}>{row.reason}</td>
					</tr>
				))}
			</Table>
			{hasMore ? (
				<div className="hl-row" ref={sentinel}>
					<span className="hl-hint">
						Showing {shown} of {rows.length}
					</span>
				</div>
			) : (
				<p className="hl-hint">{rows.length} excluded.</p>
			)}
		</>
	)
}
