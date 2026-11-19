"use client"

import Link from "next/link"
import { useCallback, useEffect, useRef, useState } from "react"
import { Badge, Button, EmptyState, statusLabel, Table } from "@/app/components/ui"
import { formatUtcDate } from "@/lib/deadline"
import type { DirectoryRow } from "@/lib/directory-rows"
import { CopyEmail } from "./CopyEmail"

interface DirectoryPage {
	items: DirectoryRow[]
	nextCursor: string | null
}

/** Whether a response is a page of the directory, checked before the list trusts it. */
const isDirectoryPage = (value: unknown): value is DirectoryPage =>
	typeof value === "object"
	&& value !== null
	&& "items" in value
	&& Array.isArray(value.items)
	&& "nextCursor" in value
	&& (typeof value.nextCursor === "string" || value.nextCursor === null)

/** How a verification status reads: verified is good, unknown is simply not checked yet, anything else is waiting on the maker. */
const verifiedTone = (verified: string): "success" | "muted" | "warning" => {
	if (verified === "verified") return "success"
	if (verified === "unknown") return "muted"
	return "warning"
}

/** Only a full set of permissions gets a colour of its own, so the column points at the accounts that matter. */
const levelTone = (level: string): "access" | "muted" => (level === "full" ? "access" : "muted")

export function UserRow({ row }: Readonly<{ row: DirectoryRow }>) {
	return (
		<tr>
			<td>
				<div className="hl-user-name">
					<Link href={`/admin/users/${row.id}`}>{row.name}</Link>
					{row.penalty === "banned" ? <Badge tone="danger">banned</Badge> : null}
					{row.penalty === "suspended" ? <Badge tone="warning">suspended</Badge> : null}
				</div>
				{row.fraudFlagged ? (
					<div>
						<Badge tone="danger">flagged</Badge>
					</div>
				) : null}
			</td>
			<td>
				<CopyEmail email={row.email} />
			</td>
			{/* Roles and access share a cell. An account with no staff role is simply a participant, so that reads as one quiet word, and only staff carry badges and an access level. */}
			<td>
				<div className="hl-user-access">
					{row.roles.length === 0 && row.level === "none" ? <span className="hl-hint">participant</span> : null}
					{row.roles.length > 0 || row.level !== "none" ? (
						<div className="hl-user-badges">
							{row.roles.map(role => (
								<Badge key={role} tone="muted">
									{role}
								</Badge>
							))}
							{row.level === "none" ? null : (
								<Badge
									title={row.granted.length > 0 ? `Can ${row.granted.join(", ")}` : "No staff permissions"}
									tone={levelTone(row.level)}
								>
									{row.levelLabel}
								</Badge>
							)}
						</div>
					) : null}
					{row.grantedCount > 0 ? (
						<span className="hl-hint">
							{row.grantedCount} of {row.permissionTotal}
						</span>
					) : null}
				</div>
			</td>
			<td>
				<Badge tone={verifiedTone(row.verified)}>{statusLabel(row.verified)}</Badge>
			</td>
			<td className="hl-mono">{formatUtcDate(new Date(row.joined))}</td>
		</tr>
	)
}

/**
 * The directory table. It starts with the first page the server rendered and asks the API for the next one as the bottom of the list comes into view, so a long directory reads like a feed rather than a series of pages.
 */
export function UserDirectory({
	initialRows,
	initialCursor,
	q,
	state,
}: Readonly<{ initialRows: DirectoryRow[]; initialCursor: string | null; q: string; state: string }>) {
	const [rows, setRows] = useState(initialRows)
	const [cursor, setCursor] = useState(initialCursor)
	const [loading, setLoading] = useState(false)
	const [failed, setFailed] = useState(false)
	const sentinel = useRef<HTMLDivElement>(null)
	const busy = useRef(false)

	const loadMore = useCallback(async (): Promise<void> => {
		if (busy.current || cursor === null) return
		busy.current = true
		setLoading(true)
		setFailed(false)
		try {
			const params = new URLSearchParams({ cursor })
			if (q) params.set("q", q)
			if (state !== "all") params.set("state", state)
			const res = await fetch(`/api/admin/users?${params}`)
			if (!res.ok) throw new Error(`HTTP ${res.status}`)
			const page: unknown = await res.json()
			if (!isDirectoryPage(page)) throw new Error("Unexpected response")
			setRows(current => [...current, ...page.items])
			setCursor(page.nextCursor)
		} catch {
			setFailed(true)
		} finally {
			busy.current = false
			setLoading(false)
		}
	}, [cursor, q, state])

	// The sentinel sits under the last row. Loading starts a screen early, so the next page is usually there before the reader reaches the end.
	useEffect(() => {
		const element = sentinel.current
		if (!element) return
		const observer = new IntersectionObserver(
			entries => {
				if (entries.some(entry => entry.isIntersecting)) void loadMore()
			},
			{ rootMargin: "600px 0px" },
		)
		observer.observe(element)
		return () => observer.disconnect()
	}, [loadMore])

	if (rows.length === 0) return <EmptyState>No users match.</EmptyState>

	return (
		<>
			<Table head={["Name", "Email", "Roles and access", "Verified", "Joined"]}>
				{rows.map(row => (
					<UserRow key={row.id} row={row} />
				))}
			</Table>
			<div aria-live="polite" className="hl-directory-footer">
				{failed ? (
					<>
						<span className="hl-hint">Could not load more users.</span>
						<Button onClick={() => void loadMore()} type="button">
							Try again
						</Button>
					</>
				) : null}
				{loading ? <span className="hl-hint">Loading more users…</span> : null}
				{!loading && !failed && cursor === null ? (
					<span className="hl-hint">All {rows.length} users are shown.</span>
				) : null}
			</div>
			<div aria-hidden="true" ref={sentinel} />
		</>
	)
}
