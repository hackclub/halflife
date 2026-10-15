import Link from "next/link"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ItemCostField } from "@/app/components/forms/ItemCostField"
import { ShopItemForm } from "@/app/components/forms/ShopItemForm"
import { ShopItemImport } from "@/app/components/forms/ShopItemImport"
import { ShopRegionForm } from "@/app/components/forms/ShopRegionForm"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import type { ShopItemCategory } from "@/app/generated/prisma/enums"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

const CATEGORY_LABEL: Record<ShopItemCategory, string> = {
	CONSUMABLE: "consumable",
	MISC: "misc",
	PRINTER: "printer",
	PRINTER_UPGRADE: "upgrade",
}

export default async function AdminShopPage() {
	await requirePermissionPage(Permission.MANAGE_SHOP)
	const [items, regions] = await Promise.all([
		prisma.shopItem.findMany({
			orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
		}),
		prisma.shopRegion.findMany({
			orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
			select: { _count: { select: { prices: true } }, active: true, id: true, name: true },
		}),
	])

	return (
		<div className="hl-stack">
			<PageHeader title="Shop items" />

			<Panel title="Catalogue">
				{items.length === 0 ? (
					<EmptyState>No items yet.</EmptyState>
				) : (
					<Table head={["Slug", "Name", "Category", "Price", "Cost (USD)", "Stock", "Gated", "Active", ""]}>
						{items.map(item => (
							<tr key={item.id}>
								<td className="hl-mono">{item.id}</td>
								<td>
									<Link href={`/admin/shop/${item.id}`}>{item.name}</Link>
								</td>
								<td>{CATEGORY_LABEL[item.category]}</td>
								<td>{item.priceCredits}</td>
								<td>
									<ItemCostField costUsd={item.costUsd} itemId={item.id} />
								</td>
								<td>{item.stock ?? "∞"}</td>
								<td>{item.requiresPrinterQualified ? "all 5 themes" : "no"}</td>
								<td>
									<Badge tone={item.active ? "success" : "muted"}>{item.active ? "active" : "retired"}</Badge>
								</td>
								<td className="hl-row" style={{ gap: "0.5rem" }}>
									<Link href={`/admin/shop/${item.id}`}>Edit</Link>
									{item.active ? (
										<ActionButton
											confirm="Retire this item? Existing orders keep working."
											label="Retire"
											method="DELETE"
											url={`/api/admin/shop/items/${item.id}`}
										/>
									) : (
										<ActionButton
											body={{ active: true }}
											label="Re-list"
											method="PATCH"
											url={`/api/admin/shop/items/${item.id}`}
										/>
									)}
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			<Panel title="Add an item">
				<ShopItemForm />
			</Panel>

			<Panel title="Import from CSV">
				<ShopItemImport />
			</Panel>
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
								<td>{region._count.prices}</td>
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
		</div>
	)
}
