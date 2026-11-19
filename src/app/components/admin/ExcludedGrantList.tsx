"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { EmptyState, Field, Select, Table, TextInput } from "@/app/components/ui"

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
	const [query, setQuery] = useState("")
	const [reason, setReason] = useState("")
	const [shown, setShown] = useState(STEP)
	const sentinel = useRef<HTMLDivElement>(null)

	// The reasons actually present, so the filter offers what this batch has rather than every reason the code can give.
	const reasons = useMemo(() => Array.from(new Set(rows.map(row => row.reason))).toSorted(), [rows])
	const term = query.trim().toLowerCase()
	const filtered = rows.filter(
		row =>
			(reason === "" || row.reason === reason)
			&& (term === "" || `${row.title} ${row.ownerName} ${row.projectId}`.toLowerCase().includes(term)),
	)
	const hasMore = shown < filtered.length

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
			{/* Filtering happens here rather than in a request: the whole batch is already worked out, so a search narrows it as it is typed. */}
			<div className="hl-filters hl-filters--search-inline">
				<div className="hl-filters__search">
					<TextInput
						aria-label="Search excluded projects"
						onChange={event => {
							setQuery(event.target.value)
							setShown(STEP)
						}}
						placeholder="Search projects or makers"
						value={query}
					/>
				</div>
				<div className="hl-filters__grid">
					<Field label="Reason">
						<Select
							onChange={event => {
								setReason(event.target.value)
								setShown(STEP)
							}}
							value={reason}
						>
							<option value="">Any reason</option>
							{reasons.map(value => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</Select>
					</Field>
				</div>
			</div>

			{filtered.length === 0 ? (
				<EmptyState>No excluded project matches.</EmptyState>
			) : (
				<Table head={["Project", "Maker", "Reason"]}>
					{filtered.slice(0, shown).map(row => (
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
			)}
			{hasMore ? (
				<div className="hl-row" ref={sentinel}>
					<span className="hl-hint">
						Showing {shown} of {filtered.length}
					</span>
				</div>
			) : (
				<p className="hl-hint">{filtered.length} excluded.</p>
			)}
		</>
	)
}
