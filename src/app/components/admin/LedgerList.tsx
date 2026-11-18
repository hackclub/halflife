"use client"

import Link from "next/link"
import { Badge, Button, EmptyState, Table } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import type { LedgerKind } from "@/lib/enums"
import { ledgerKindLabel, ledgerKindTone } from "@/lib/ledger-filters"
import { useInfiniteRows } from "./useInfiniteRows"

/** One ledger line as the API sends it: the timestamp as text, the rest as the server computed it. */
export interface LedgerListRow {
	amount: number
	createdAt: string
	id: string
	kind: LedgerKind
	note: string | null
	user: { id: string; name: string | null }
}

interface LedgerPage {
	items: LedgerListRow[]
	nextCursor: string | null
}

const isLedgerPage = (value: unknown): value is LedgerPage =>
	typeof value === "object"
	&& value !== null
	&& "items" in value
	&& Array.isArray(value.items)
	&& "nextCursor" in value
	&& (typeof value.nextCursor === "string" || value.nextCursor === null)

/** Figures that line up when read down a column, right-aligned on the cell itself so the edge follows the column rather than each value. */
const NUMERIC = { fontVariantNumeric: "tabular-nums", textAlign: "right" } as const

/**
 * The ledger's rows, loading the next page as the bottom of the table comes into view. The filters are in `baseUrl`, so a new search remounts this list rather than appending to the old one.
 */
export function LedgerList({
	baseUrl,
	initialCursor,
	initialRows,
}: Readonly<{ baseUrl: string; initialCursor: string | null; initialRows: LedgerListRow[] }>) {
	const { cursor, failed, loadMore, loading, rows, sentinel } = useInfiniteRows<LedgerListRow>({
		baseUrl,
		initialCursor,
		initialRows,
		isPage: isLedgerPage,
	})

	if (rows.length === 0) return <EmptyState>No ledger entries match.</EmptyState>

	return (
		<>
			<Table
				head={[
					"When",
					"Participant",
					"Kind",
					"Note",
					<span key="amount" style={NUMERIC}>
						Amount
					</span>,
				]}
			>
				{rows.map(entry => (
					<tr key={entry.id}>
						<td className="hl-mono">{formatUtcDateTime(new Date(entry.createdAt))}</td>
						<td>
							<Link href={`/admin/users/${entry.user.id}`}>{entry.user.name ?? "-"}</Link>
						</td>
						<td>
							<Badge tone={ledgerKindTone(entry.kind)}>{ledgerKindLabel(entry.kind)}</Badge>
						</td>
						<td>{entry.note ?? <span className="hl-hint">-</span>}</td>
						<td
							className="hl-mono"
							style={{ ...NUMERIC, color: entry.amount > 0 ? "var(--color-success-ink)" : undefined }}
						>
							{entry.amount > 0 ? `+${entry.amount}` : entry.amount}
						</td>
					</tr>
				))}
			</Table>
			<div aria-live="polite" className="hl-directory-footer">
				{failed ? (
					<>
						<span className="hl-hint">Could not load more entries.</span>
						<Button onClick={loadMore} type="button">
							Try again
						</Button>
					</>
				) : null}
				{loading ? <span className="hl-hint">Loading more entries…</span> : null}
				{!loading && !failed && cursor === null ? (
					<span className="hl-hint">All {rows.length} entries are shown.</span>
				) : null}
			</div>
			<div aria-hidden="true" ref={sentinel} />
		</>
	)
}
