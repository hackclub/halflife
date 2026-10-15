import Link from "next/link"
import { OrderDecision } from "@/app/components/forms/OrderDecision"
import { OrderFulfillment } from "@/app/components/forms/OrderFulfillment"
import { PrinterAwardForm } from "@/app/components/forms/PrinterAwardForm"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/app/generated/prisma/enums"
import { displayName } from "@/lib/display-name"
import { METHOD_LABELS, STAGE_LABELS } from "@/lib/fulfillment"
import { formatUsd } from "@/lib/money"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { PRINTER_AWARD_LABELS } from "@/lib/printer-award"
import { type FulfillmentFilters, listFulfillmentOrders, listPrinterAwards } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

type Search = {
	from?: string
	to?: string
	method?: string
	stage?: string
	cursor?: string
}
type Props = { searchParams: Promise<Search> }

const DAY_MS = 24 * 60 * 60 * 1000

/** A `YYYY-MM-DD` from a date input, as midnight UTC. Anything else is dropped. */
function utcDay(v?: string): Date | undefined {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
	const d = new Date(`${v}T00:00:00Z`)
	return Number.isNaN(d.getTime()) ? undefined : d
}

/** Anything unrecognised in the query string is dropped, not trusted. */
function filtersFrom(s: Search): FulfillmentFilters {
	const to = utcDay(s.to)
	return {
		placedFrom: utcDay(s.from),
		// The "to" day is inclusive, so the bound is the midnight after it.
		placedBefore: to ? new Date(to.getTime() + DAY_MS) : undefined,
		method: s.method === "NONE" ? "NONE" : Object.values(ShopFulfillmentMethod).find(m => m === s.method),
		stage: Object.values(ShopFulfillmentStage).find(x => x === s.stage),
	}
}

const placedFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	dateStyle: "medium",
	timeStyle: "short",
})

/** Award-state colours, matching the badge tones the console already uses. */
const AWARD_TONES = {
	QUALIFIED: "muted",
	ADDRESS_LOCKED: "warning",
	PACKING: "warning",
	SHIPPED: "success",
	DELIVERED: "success",
	REVOKED: "danger",
} as const

export default async function AdminFulfillmentPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.FULFILL_ORDERS)
	const search = await searchParams
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
		<div className="hl-stack">
			<PageHeader subtitle="Every order that was not rejected, including cancelled ones." title="Fulfillment" />

			<Panel>
				<form className="hl-row" method="get" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
					<label className="hl-stack hl-stack--tight" style={{ gap: "0.25rem" }}>
						<span className="hl-label-text">Placed from</span>
						<input className="hl-input" defaultValue={search.from ?? ""} name="from" type="date" />
					</label>
					<label className="hl-stack hl-stack--tight" style={{ gap: "0.25rem" }}>
						<span className="hl-label-text">Placed to</span>
						<input className="hl-input" defaultValue={search.to ?? ""} name="to" type="date" />
					</label>
					<select className="hl-input" defaultValue={filters.method ?? ""} name="method" style={{ maxWidth: "14rem" }}>
						<option value="">Any method</option>
						<option value="NONE">Method not chosen</option>
						{Object.entries(METHOD_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
					<select className="hl-input" defaultValue={filters.stage ?? ""} name="stage" style={{ maxWidth: "14rem" }}>
						<option value="">Any stage</option>
						{Object.entries(STAGE_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
					<button className="hl-btn" type="submit">
						Filter
					</button>
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
					<Table head={["#", "Participant", "Item", "Cost (USD)", "Country", "Placed", "Fulfillment", "Decision"]}>
						{items.map(order => (
							<tr key={order.id}>
								<td className="hl-mono">{order.orderNumber}</td>
								<td>
									<Link href={`/admin/users/${order.user.id}`}>{displayName(order.user)}</Link>
									{order.status === "PENDING" || order.status === "ON_HOLD" ? (
										<div>
											<Badge tone="warning">{order.status.toLowerCase().replace("_", " ")}</Badge>
										</div>
									) : order.status === "CANCELLED" ? (
										<div>
											<Badge tone="danger">cancelled by participant</Badge>
										</div>
									) : null}
								</td>
								<td>
									{order.itemNameSnapshot}
									{order.quantity > 1 ? <span className="hl-hint"> ×{order.quantity}</span> : null}
								</td>
								<td className="hl-mono">
									{order.totalUsd === null ? <span className="hl-hint">not set</span> : formatUsd(order.totalUsd)}
								</td>
								<td>{order.country ?? <span className="hl-hint">unknown</span>}</td>
								<td className="hl-mono">{placedFormat.format(order.placedAt)}</td>
								<td>
									<OrderFulfillment
										cancelled={order.status === "CANCELLED"}
										method={order.fulfillmentMethod}
										orderId={order.id}
										stage={order.fulfillmentStage}
									/>
								</td>
								<td>
									{order.status === "PENDING" || order.status === "ON_HOLD" ? (
										<OrderDecision orderId={order.id} />
									) : (
										<span className="hl-hint">{order.status.toLowerCase()}</span>
									)}
								</td>
							</tr>
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
					<Table head={["Participant", "Qualified", "Status", "Address", "Tracking", "Update"]}>
						{awards.map(award => (
							<tr key={award.id}>
								<td>
									<Link href={`/admin/users/${award.user.id}`}>{displayName(award.user)}</Link>
								</td>
								<td className="hl-mono">{placedFormat.format(award.qualifiedAt)}</td>
								<td>
									<Badge tone={AWARD_TONES[award.status]}>{PRINTER_AWARD_LABELS[award.status]}</Badge>
									{award.status === "REVOKED" && award.revokedReason ? (
										<div className="hl-hint">{award.revokedReason}</div>
									) : null}
								</td>
								<td>
									{award.addressOnFile ? "locked on file" : <span className="hl-hint">none</span>}
									{award.addressLockedAt ? (
										<div className="hl-hint">{placedFormat.format(award.addressLockedAt)}</div>
									) : null}
								</td>
								<td className="hl-mono">
									{award.trackingNumber ? (
										`${award.trackingCarrier ?? ""} ${award.trackingNumber}`.trim()
									) : (
										<span className="hl-hint">–</span>
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
