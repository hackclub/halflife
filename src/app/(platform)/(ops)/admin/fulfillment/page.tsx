import type { Metadata } from "next"
import Link from "next/link"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { PrinterAwardForm } from "@/app/components/forms/PrinterAwardForm"
import { Badge, EmptyState, Field, FilterBar, PageHeader, Panel, Select, Table, TextInput } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import { DELIVERY_LABELS, METHOD_LABELS, STAGE_LABELS } from "@/lib/fulfillment"
import { FULFILLMENT_PAGE_SIZE, fulfillmentFiltersFrom, toFulfillmentJson } from "@/lib/fulfillment-sheet"
import { listLegacyShopPreview } from "@/lib/legacy-shop-dm"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { PRINTER_AWARD_LABELS } from "@/lib/printer-award"
import { listPrinterAwards } from "@/lib/queries/admin"
import { listFulfillmentOrders } from "@/lib/queries/fulfillment"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { listShopGrantCardBatch } from "@/lib/shop-grant-card-batch"
import { CardBatch } from "./CardBatch"
import { FulfillmentList } from "./FulfillmentList"
import { LegacyDmPanel } from "./LegacyDmPanel"

export const metadata: Metadata = {
	title: "Fulfillment",
}

export const dynamic = "force-dynamic"

interface Search {
	delivery?: SearchParamValue
	from?: SearchParamValue
	method?: SearchParamValue
	order?: SearchParamValue
	stage?: SearchParamValue
	status?: SearchParamValue
	tab?: SearchParamValue
	to?: SearchParamValue
}
interface Props {
	searchParams: Promise<Search>
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

/** The order statuses the sheet lists, in plain words. Pending and fulfilled are separate here even when a grant card leaves both in the same stage. */
const ORDER_STATUS_LABELS: { [_: string]: string } = {
	CANCELLED: "Cancelled by participant",
	FULFILLED: "Fulfilled",
	ON_HOLD: "On hold",
	PENDING: "Pending",
}

/** The tabs in the order the chips and the [ and ] keys step through them. */
const TABS = [
	{ id: "orders", label: "Orders" },
	{ id: "batch", label: "Card batch" },
	{ id: "dms", label: "Legacy DMs" },
	{ id: "printers", label: "Printers" },
] as const

type FulfillmentTab = (typeof TABS)[number]["id"]

const tabHref = (id: FulfillmentTab) => (id === "orders" ? "/admin/fulfillment" : `/admin/fulfillment?tab=${id}`)

export default async function AdminFulfillmentPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.FULFILL_ORDERS)
	// Every filter and the tab, taken as the single value the URL named: a repeated parameter arrives as an array, and an array is not a value this page can read.
	const search = firstValues(await searchParams)
	const tab: FulfillmentTab = TABS.find(item => item.id === search.tab)?.id ?? "orders"

	const filters = fulfillmentFiltersFrom(search)
	const [orders, awards, batch, dms] = await Promise.all([
		tab === "orders" ? listFulfillmentOrders(filters, { limit: FULFILLMENT_PAGE_SIZE }) : null,
		tab === "printers" ? listPrinterAwards() : null,
		tab === "batch" ? listShopGrantCardBatch() : null,
		tab === "dms" ? listLegacyShopPreview() : null,
	])

	// The rows below load more through the same filters, so the list's address carries them all.
	const filterParams = new URLSearchParams(
		Object.entries({
			delivery: search.delivery,
			from: search.from,
			method: search.method,
			order: search.order,
			stage: search.stage,
			status: search.status,
			to: search.to,
		}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
	)
	const filterKey = filterParams.toString()
	const listParams = new URLSearchParams(filterParams)
	listParams.set("limit", String(FULFILLMENT_PAGE_SIZE))
	// A row's status links to the sheet filtered to its own status, so the address keeps the other filters and the row's status replaces the page's.
	const linkParams = new URLSearchParams(
		Object.entries({
			delivery: search.delivery,
			from: search.from,
			method: search.method,
			status: search.status,
			to: search.to,
		}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
	)

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader
				actions={
					<div className="hl-row">
						{TABS.map((item, index) => (
							<Link
								aria-current={item.id === tab || undefined}
								aria-keyshortcuts={`Alt+${index + 1}`}
								className="hl-chip"
								href={tabHref(item.id)}
								key={item.id}
							>
								{item.label}
								<kbd className="hl-hotkey hl-tab-key">{index + 1}</kbd>
							</Link>
						))}
					</div>
				}
				compact
				subtitle="Every order that was not rejected, including cancelled ones."
				title="Fulfillment"
			/>
			<TabKeys current={tabHref(tab)} hrefs={TABS.map(item => tabHref(item.id))} />

			{orders ? (
				<>
					<Panel>
						<FilterBar
							footer={
								<span className="hl-hint">
									Dates are UTC. A grant card request means the participant asked for the item&rsquo;s value on an HCB
									card instead of shipping.
								</span>
							}
							resetHref="/admin/fulfillment"
						>
							<div className="hl-filter-group">
								<Field label="Placed from">
									<TextInput defaultValue={search.from ?? ""} name="from" type="date" />
								</Field>
								<Field label="Placed to">
									<TextInput defaultValue={search.to ?? ""} name="to" type="date" />
								</Field>
							</div>
							<div className="hl-filter-group">
								<Field label="Delivery">
									<Select defaultValue={filters.delivery ?? ""} name="delivery">
										<option value="">Any delivery</option>
										<option value="NONE">Not chosen</option>
										{Object.entries(DELIVERY_LABELS).map(([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Method">
									<Select defaultValue={filters.method ?? ""} name="method">
										<option value="">Any method</option>
										<option value="NONE">Method not chosen</option>
										{Object.entries(METHOD_LABELS).map(([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Status">
									<Select defaultValue={filters.status ?? ""} name="status">
										<option value="">Any status</option>
										{Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Stage">
									<Select defaultValue={filters.stage ?? ""} name="stage">
										<option value="">Any stage</option>
										{Object.entries(STAGE_LABELS).map(([value, label]) => (
											<option key={value} value={value}>
												{label}
											</option>
										))}
									</Select>
								</Field>
							</div>
						</FilterBar>
					</Panel>

					<Panel>
						{/* Keyed on the filters, so a new search starts a new list rather than appending to the old one. */}
						<FulfillmentList
							baseUrl={`/api/admin/fulfillment?${listParams}`}
							filters={linkParams.toString()}
							initialCursor={orders.nextCursor}
							initialRows={orders.items.map(toFulfillmentJson)}
							key={filterKey}
						/>
					</Panel>
				</>
			) : null}

			{batch ? <CardBatch blocked={batch.blocked} groups={batch.groups} /> : null}

			{dms ? <LegacyDmPanel preview={dms} /> : null}

			{awards ? (
				<Panel title="Printers earned">
					{awards.length === 0 ? (
						<EmptyState>Nobody has shipped all five projects yet.</EmptyState>
					) : (
						<Table
							className="hl-table--roomy hl-table--pin-last"
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
						A printer is earned by shipping all five projects; the address is snapshotted from the participant&apos;s
						HCA profile when it is locked, so later edits there cannot move a package already being packed.
					</p>
				</Panel>
			) : null}
		</div>
	)
}
