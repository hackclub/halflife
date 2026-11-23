import { or } from "@prisma/orm-postgres/orm-client"
import type { Metadata } from "next"
import Link from "next/link"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ItemCostField } from "@/app/components/forms/ItemCostField"
import { ShopItemForm } from "@/app/components/forms/ShopItemForm"
import { ShopItemImport } from "@/app/components/forms/ShopItemImport"
import { ShopRegionForm } from "@/app/components/forms/ShopRegionForm"
import {
	Badge,
	Button,
	EmptyState,
	Field,
	FilterBar,
	LinkButton,
	PageHeader,
	Panel,
	Select,
	Table,
	TextInput,
} from "@/app/components/ui"
import { IconSearch } from "@/app/components/ui/icons"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { containsPattern } from "@/lib/text"

export const metadata: Metadata = {
	title: "Shop items",
}

export const dynamic = "force-dynamic"

type ShopItemCategory = Models.public_ShopItem["category"]

const CATEGORY_LABEL: { [_ in ShopItemCategory]: string } = {
	CONSUMABLE: "consumable",
	MISC: "misc",
	PRINTER: "printer",
	PRINTER_UPGRADE: "upgrade",
}

type ItemStatus = "active" | "all" | "retired"

/** The tabs in the order the chips and the [ and ] keys step through them. */
const TABS = [
	{ id: "catalogue", label: "Catalogue" },
	{ id: "new", label: "New item" },
	{ id: "import", label: "Import" },
	{ id: "regions", label: "Regions" },
] as const

type ShopTab = (typeof TABS)[number]["id"]

const tabHref = (id: ShopTab) => (id === "catalogue" ? "/admin/shop" : `/admin/shop?tab=${id}`)

interface Search {
	category?: SearchParamValue
	gated?: SearchParamValue
	q?: SearchParamValue
	status?: SearchParamValue
	tab?: SearchParamValue
}
interface Props {
	searchParams: Promise<Search>
}

export default async function AdminShopPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.MANAGE_SHOP)
	// Every filter and the tab, taken as the single value the URL named: a repeated parameter arrives as an array, which is not a value this page can read.
	const search = firstValues(await searchParams)
	const tab: ShopTab = TABS.find(item => item.id === search.tab)?.id ?? "catalogue"
	// Anything unrecognised in the query string is dropped, not trusted.
	const category = Object.keys(CATEGORY_LABEL).find((value): value is ShopItemCategory => value === search.category)
	const status: ItemStatus = search.status === "active" || search.status === "retired" ? search.status : "all"
	const gated = search.gated === "1"

	return (
		<div className="hl-stack">
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
				title="Shop items"
			/>
			<TabKeys current={tabHref(tab)} hrefs={TABS.map(item => tabHref(item.id))} />

			{tab === "catalogue" ? <CatalogueTab category={category} gated={gated} q={search.q} status={status} /> : null}

			{tab === "new" ? (
				<Panel title="Add an item">
					<ShopItemForm />
				</Panel>
			) : null}

			{tab === "import" ? (
				<Panel title="Import from CSV">
					<ShopItemImport />
				</Panel>
			) : null}

			{tab === "regions" ? <RegionsTab /> : null}
		</div>
	)
}

/** The catalogue with its status changed, keeping the other filters. */
function catalogueHref(
	filters: Readonly<{ category?: ShopItemCategory; gated: boolean; q?: string }>,
	status: ItemStatus,
): string {
	const params = new URLSearchParams()
	if (filters.q) params.set("q", filters.q)
	if (filters.category) params.set("category", filters.category)
	if (filters.gated) params.set("gated", "1")
	params.set("status", status)
	return `/admin/shop?${params.toString()}`
}

/** The catalogue, filtered by the bar above it. Only its query runs when this tab is open. */
async function CatalogueTab({
	category,
	gated,
	q,
	status,
}: Readonly<{ category?: ShopItemCategory; gated: boolean; q?: string; status: ItemStatus }>) {
	const term = q?.trim()
	let query = db.orm.public.ShopItem.orderBy([item => item.sortOrder.asc(), item => item.name.asc()])
	if (term) {
		const pattern = containsPattern(term)
		query = query.where(item => or(item.name.ilike(pattern), item.id.ilike(pattern)))
	}
	if (category) query = query.where({ category })
	if (status === "active") query = query.where({ active: true })
	if (status === "retired") query = query.where({ active: false })
	if (gated) query = query.where({ requiresPrinterQualified: true })
	const items = await query.all()

	return (
		<>
			<Panel>
				<FilterBar
					footer={
						<div className="hl-filters__toggles">
							<label>
								<input defaultChecked={gated} name="gated" type="checkbox" value="1" />
								Printer-qualified only
							</label>
						</div>
					}
					leading={
						<div className="hl-filters__search">
							<TextInput
								aria-label="Search items"
								defaultValue={q ?? ""}
								name="q"
								placeholder="Search by name or slug"
							/>
							<Button type="submit">
								<IconSearch /> Search
							</Button>
						</div>
					}
					resetHref="/admin/shop"
				>
					<Field label="Category">
						<Select defaultValue={category ?? ""} name="category">
							<option value="">Any category</option>
							{Object.entries(CATEGORY_LABEL).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Status">
						{/* The select is uncontrolled, so it keeps whatever it was first given: the key remounts it when a status badge sets the filter, or the bar would say "Any status" over a filtered list. */}
						<Select defaultValue={status} key={status} name="status">
							<option value="all">Any status</option>
							<option value="active">Active</option>
							<option value="retired">Retired</option>
						</Select>
					</Field>
				</FilterBar>
			</Panel>

			<Panel title="Catalogue">
				{items.length === 0 ? (
					<EmptyState>No items match.</EmptyState>
				) : (
					<Table
						className="hl-table--shop"
						head={["Slug", "Name", "Category", "Price", "Cost (USD)", "Stock", "Gated", "Active", "Manage"]}
					>
						{items.map(item => (
							<tr key={item.id}>
								<td>
									<span className="hl-mono" title={item.id}>
										{item.id}
									</span>
								</td>
								<td>
									<Link href={`/admin/shop/${item.id}`}>{item.name}</Link>
								</td>
								<td>{CATEGORY_LABEL[item.category]}</td>
								<td>{item.priceCredits}</td>
								<td>
									<ItemCostField costUsd={item.costUsd} itemId={item.id} />
								</td>
								<td>{item.stock ?? "∞"}</td>
								<td>{item.requiresPrinterQualified ? "all 5 projects" : "no"}</td>
								<td>
									<Link
										href={catalogueHref({ category, gated, q }, item.active ? "active" : "retired")}
										title={item.active ? "Show only active items" : "Show only retired items"}
									>
										<Badge tone={item.active ? "success" : "muted"}>{item.active ? "active" : "retired"}</Badge>
									</Link>
								</td>
								<td className="hl-shop-actions">
									<LinkButton href={`/admin/shop/${item.id}`}>Edit</LinkButton>
									{item.active ? (
										<ActionButton
											confirm="Retire this item? Existing orders keep working."
											label="Retire"
											method="DELETE"
											url={`/api/admin/shop/items/${item.id}`}
											variant="danger"
										/>
									) : (
										<ActionButton
											body={{ active: true }}
											label="Re-list"
											method="PATCH"
											url={`/api/admin/shop/items/${item.id}`}
											variant="primary"
										/>
									)}
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>
		</>
	)
}

/** The sales regions and their overrides. Only its query runs when this tab is open. */
async function RegionsTab() {
	const regions = await db.orm.public.ShopRegion.select("id", "name", "active")
		.include("prices", prices => prices.count())
		.orderBy([region => region.sortOrder.asc(), region => region.name.asc()])
		.all()

	return (
		<Panel title="Regions">
			<p className="hl-hint">
				Sales regions staff can price items for separately. Participants pick theirs on the shop page; an item with no
				override for a region sells there at its base price. Switching a region off falls everyone on it back to base
				pricing.
			</p>
			{regions.length > 0 && (
				<Table head={["Slug", "Name", "Overrides", "Active", ""]}>
					{regions.map(region => (
						<tr key={region.id}>
							<td className="hl-mono">{region.id}</td>
							<td>{region.name}</td>
							<td>{region.prices}</td>
							<td>
								<Badge tone={region.active ? "success" : "muted"}>{region.active ? "active" : "off"}</Badge>
							</td>
							<td>
								<ActionButton
									body={{ active: !region.active }}
									confirm={
										region.active
											? "Switch this region off? Everyone on it falls back to base pricing."
											: "Switch this region on?"
									}
									label={region.active ? "Switch off" : "Switch on"}
									method="PATCH"
									url={`/api/admin/shop/regions/${region.id}`}
								/>
							</td>
						</tr>
					))}
				</Table>
			)}
			<ShopRegionForm />
		</Panel>
	)
}
