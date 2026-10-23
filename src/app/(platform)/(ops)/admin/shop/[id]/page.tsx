import Link from "next/link"
import { notFound } from "next/navigation"
import { ItemRegionPrices } from "@/app/components/forms/ItemRegionPrices"
import { ShopItemForm } from "@/app/components/forms/ShopItemForm"
import { Badge, PageHeader, Panel } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"

export const dynamic = "force-dynamic"

/** One shop item, to edit. Retiring and re-listing stay on the catalogue. */
export default async function AdminShopItemPage({ params }: { params: Promise<{ id: string }> }) {
	await requirePermissionPage(Permission.MANAGE_SHOP)
	const { id } = await params
	const [item, regions] = await Promise.all([
		db.orm.public.ShopItem.whereUnique({ id })
			.include("regionPrices", prices => prices.select("regionId", "priceCredits"))
			.first(),
		db.orm.public.ShopRegion.select("id", "name")
			.orderBy([r => r.sortOrder.asc(), r => r.name.asc()])
			.all(),
	])
	if (!item) notFound()

	const overrides = new Map(item.regionPrices.map(r => [r.regionId, r.priceCredits]))

	return (
		<div className="hl-stack">
			<p>
				<Link href="/admin/shop">← Shop items</Link>
			</p>
			<PageHeader title={item.name} />
			<Panel title="Edit item">
				<p className="hl-hint" style={{ marginBottom: "0.75rem" }}>
					<Badge tone={item.active ? "success" : "muted"}>{item.active ? "active" : "retired"}</Badge> Changes apply to
					new orders; orders already placed keep what they were bought at.
				</p>
				<ShopItemForm
					item={{
						category: item.category,
						costUsd: item.costUsd,
						description: item.description,
						id: item.id,
						imageUrl: item.imageUrl,
						name: item.name,
						priceCredits: item.priceCredits,
						requiresPrinterQualified: item.requiresPrinterQualified,
					}}
				/>
			</Panel>
			<Panel title="Regional prices">
				<p className="hl-hint" style={{ marginBottom: "0.75rem" }}>
					Coin prices per sales region. Base price is {item.priceCredits}; orders keep the price they were charged.
				</p>
				<ItemRegionPrices
					basePrice={item.priceCredits}
					itemId={item.id}
					regions={regions.map(r => ({ id: r.id, name: r.name, price: overrides.get(r.id) ?? null }))}
				/>
			</Panel>
		</div>
	)
}
