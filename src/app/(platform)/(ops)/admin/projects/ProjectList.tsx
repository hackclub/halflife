"use client"

import type { ProjectManageFlags } from "@/app/components/admin/ProjectManagePanel"
import { useInfiniteRows } from "@/app/components/admin/useInfiniteRows"
import { Button, EmptyState, Table } from "@/app/components/ui"
import { ProjectRow, type ProjectRowData } from "./ProjectRow"

interface ProjectPage {
	items: ProjectRowData[]
	nextCursor: string | null
}

const isProjectPage = (value: unknown): value is ProjectPage =>
	typeof value === "object"
	&& value !== null
	&& "items" in value
	&& Array.isArray(value.items)
	&& "nextCursor" in value
	&& (typeof value.nextCursor === "string" || value.nextCursor === null)

/**
 * The project rows, loading the next page as the bottom of the table comes into view. The filters are in `baseUrl`, so a new search remounts this list rather than appending to the old one.
 */
export function ProjectList({
	baseUrl,
	flags,
	initialCursor,
	initialRows,
}: Readonly<{
	baseUrl: string
	flags: ProjectManageFlags
	initialCursor: string | null
	initialRows: ProjectRowData[]
}>) {
	const { cursor, failed, loadMore, loading, rows, sentinel } = useInfiniteRows<ProjectRowData>({
		baseUrl,
		initialCursor,
		initialRows,
		isPage: isProjectPage,
		keyOf: data => data.id,
	})
	const canManage = Object.values(flags).some(Boolean)

	if (rows.length === 0) return <EmptyState>No projects match.</EmptyState>

	return (
		<>
			<Table
				className="hl-table--roomy hl-table--projects"
				head={["Project", "Owner", "Theme", "Tier", "Review", canManage ? "Actions" : "Extension"]}
			>
				{rows.map(data => (
					<ProjectRow data={data} flags={flags} key={data.id} />
				))}
			</Table>
			<div aria-live="polite" className="hl-directory-footer">
				{failed ? (
					<>
						<span className="hl-hint">Could not load more projects.</span>
						<Button onClick={loadMore} type="button">
							Try again
						</Button>
					</>
				) : null}
				{loading ? <span className="hl-hint">Loading more projects…</span> : null}
				{!loading && !failed && cursor === null ? (
					<span className="hl-hint">All {rows.length} projects are shown.</span>
				) : null}
			</div>
			<div aria-hidden="true" ref={sentinel} />
		</>
	)
}
