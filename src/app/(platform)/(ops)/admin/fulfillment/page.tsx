import Link from "next/link"
import { PrinterAwardForm } from "@/app/components/forms/PrinterAwardForm"
import { Badge, Button, EmptyState, Field, PageHeader, Panel, Select, Table, TextInput } from "@/app/components/ui"
import { IconFilter } from "@/app/components/ui/icons"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/lib/enums"
import { METHOD_LABELS, STAGE_LABELS } from "@/lib/fulfillment"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { PRINTER_AWARD_LABELS } from "@/lib/printer-award"
import { type FulfillmentFilters, listFulfillmentOrders, listPrinterAwards } from "@/lib/queries/admin"
import { type FirstValues, firstValues, type SearchParamValue } from "@/lib/search-params"
import { DAY_MS } from "@/lib/time"
import { FulfillmentRow } from "./FulfillmentRow"

export const dynamic = "force-dynamic"

interface Search {
	cursor?: SearchParamValue
	from?: SearchParamValue
	method?: SearchParamValue
	stage?: SearchParamValue
	to?: SearchParamValue
}
interface Props {
	searchParams: Promise<Search>
}

/** A `YYYY-MM-DD` from a date input, as midnight UTC. Anything else is dropped. */
function utcDay(v?: string): Date | undefined {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
	const d = new Date(`${v}T00:00:00Z`)
	return Number.isNaN(d.getTime()) ? undefined : d
}

/** Anything unrecognised in the query string is dropped, not trusted. */
function filtersFrom(s: FirstValues<Search>): FulfillmentFilters {
	const to = utcDay(s.to)
	return {
		method: s.method === "NONE" ? "NONE" : Object.values(ShopFulfillmentMethod).find(m => m === s.method),
		// The "to" day is inclusive, so the bound is the midnight after it.
		placedBefore: to ? new Date(to.getTime() + DAY_MS) : undefined,
		placedFrom: utcDay(s.from),
		stage: Object.values(ShopFulfillmentStage).find(x => x === s.stage),
	}
}

/** Award-state colours, matching the badge tones the console already uses. */
const AWARD_TONES = {
	ADDRESS_LOCKED: "warning",
	DELIVERED: "success",
	PACKING: "warning",
	QUALIFIED: "muted",
	REVOKED: "danger",
	SHIPPED: "success",
} as const

export default async function AdminFulfillmentPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.FULFILL_ORDERS)
	// Every filter, taken as the single value the URL named: a repeated parameter arrives as an array, and an array is not a value this page can read.
	const search = firstValues(await searchParams)
	const filters = filtersFrom(search)

	const [{ items, nextCursor }, awards] = await Promise.all([
		listFulfillmentOrders(filters, {
			cursor: search.cursor,
			limit: 50,
		}),
		listPrinterAwards(),
	])

	// The next page keeps every filter; only the cursor moves.
	const nextParams = new URLSearchParams(
		Object.entries({ ...search, cursor: nextCursor ?? undefined }).filter(
			(e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
		),
	)

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader subtitle="Every order that was not rejected, including cancelled ones." title="Fulfillment" />

			<Panel>
				<form className="hl-row" method="get" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
					<Field label="Placed from">
						<TextInput defaultValue={search.from ?? ""} name="from" type="date" />
					</Field>
					<Field label="Placed to">
						<TextInput defaultValue={search.to ?? ""} name="to" type="date" />
					</Field>
					<Select defaultValue={filters.method ?? ""} name="method" style={{ maxWidth: "14rem" }}>
						<option value="">Any method</option>
						<option value="NONE">Method not chosen</option>
						{Object.entries(METHOD_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
					<Select defaultValue={filters.stage ?? ""} name="stage" style={{ maxWidth: "14rem" }}>
						<option value="">Any stage</option>
						{Object.entries(STAGE_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</Select>
					<Button type="submit">
						<IconFilter /> Filter
					</Button>
					<Link className="hl-hint" href="/admin/fulfillment">
						Reset
					</Link>
				</form>
				<span className="hl-hint">Dates are UTC.</span>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>No orders match.</EmptyState>
				) : (
					<Table
						className="hl-table--roomy"
						head={["#", "Participant", "Item", "Cost (USD)", "Country", "Placed", "Status", "Manage"]}
					>
						{items.map(order => (
							<FulfillmentRow key={order.id} order={order} />
						))}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link href={`/admin/fulfillment?${nextParams.toString()}`}>Next page</Link>
					</p>
				) : null}
			</Panel>

			<Panel title="Printers earned">
				{awards.length === 0 ? (
					<EmptyState>Nobody has shipped all five themes yet.</EmptyState>
				) : (
					<Table
						className="hl-table--roomy"
						head={["Participant", "Qualified", "Status", "Address", "Tracking", "Update"]}
					>
						{awards.map(award => (
							<tr key={award.id}>
								<td>
									<Link href={`/admin/users/${award.user.id}`}>{displayName(award.user)}</Link>
								</td>
								<td className="hl-mono">{formatUtcDateTime(award.qualifiedAt)}</td>
								<td>
									<Badge tone={AWARD_TONES[award.status]}>{PRINTER_AWARD_LABELS[award.status]}</Badge>
									{award.status === "REVOKED" && award.revokedReason ? (
										<div className="hl-hint">{award.revokedReason}</div>
									) : null}
								</td>
								<td>
									{award.addressOnFile ? "locked on file" : <span className="hl-hint">none</span>}
									{award.addressLockedAt ? (
										<div className="hl-hint">{formatUtcDateTime(award.addressLockedAt)}</div>
									) : null}
								</td>
								<td className="hl-mono">
									{award.trackingNumber ? (
										`${award.trackingCarrier ?? ""} ${award.trackingNumber}`.trim()
									) : (
										<span className="hl-hint">-</span>
									)}
								</td>
								<td>
									<PrinterAwardForm awardId={award.id} status={award.status} />
								</td>
							</tr>
						))}
					</Table>
				)}
				<p className="hl-hint">
					A printer is earned by shipping all five themes; the address is snapshotted from the participant&apos;s HCA
					profile when it is locked, so later edits there cannot move a package already being packed.
				</p>
			</Panel>
		</div>
	)
}
