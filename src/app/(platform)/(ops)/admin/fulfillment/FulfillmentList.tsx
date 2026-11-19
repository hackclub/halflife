"use client"

import { useInfiniteRows } from "@/app/components/admin/useInfiniteRows"
import { Button, EmptyState, Table } from "@/app/components/ui"
import type { FulfillmentOrderJson } from "@/lib/fulfillment-sheet"
import { FulfillmentRow } from "./FulfillmentRow"

interface OrderPage {
	items: FulfillmentOrderJson[]
	nextCursor: string | null
}

const isOrderPage = (value: unknown): value is OrderPage =>
	typeof value === "object"
	&& value !== null
	&& "items" in value
	&& Array.isArray(value.items)
	&& "nextCursor" in value
	&& (typeof value.nextCursor === "string" || value.nextCursor === null)

/**
 * The orders on the sheet, loading the next page as the bottom of the table comes into view. The filters are in `baseUrl`, so a new search remounts this list rather than appending to the old one.
 */
export function FulfillmentList({
	baseUrl,
	filters,
	initialCursor,
	initialRows,
}: Readonly<{ baseUrl: string; filters: string; initialCursor: string | null; initialRows: FulfillmentOrderJson[] }>) {
	const { cursor, failed, loadMore, loading, rows, sentinel } = useInfiniteRows<FulfillmentOrderJson>({
		baseUrl,
		initialCursor,
		initialRows,
		isPage: isOrderPage,
		keyOf: order => order.id,
	})

	if (rows.length === 0) return <EmptyState>No orders match.</EmptyState>

	return (
		<>
			<Table
				className="hl-table--roomy"
				head={["#", "Participant", "Item", "Cost (USD)", "Country", "Placed", "Status", "Manage"]}
			>
				{rows.map(order => (
					<FulfillmentRow filters={filters} key={order.id} order={order} />
				))}
			</Table>
			<div aria-live="polite" className="hl-directory-footer">
				{failed ? (
					<>
						<span className="hl-hint">Could not load more orders.</span>
						<Button onClick={loadMore} type="button">
							Try again
						</Button>
					</>
				) : null}
				{loading ? <span className="hl-hint">Loading more orders…</span> : null}
				{!loading && !failed && cursor === null ? (
					<span className="hl-hint">All {rows.length} orders are shown.</span>
				) : null}
			</div>
			<div aria-hidden="true" ref={sentinel} />
		</>
	)
}
