import Link from "next/link"
import { notFound } from "next/navigation"
import { ShopItemForm } from "@/app/components/forms/ShopItemForm"
import { Badge, PageHeader, Panel } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

/** One shop item, to edit. Retiring and re-listing stay on the catalogue. */
export default async function AdminShopItemPage({ params }: { params: Promise<{ id: string }> }) {
	await requirePermissionPage(Permission.MANAGE_SHOP)
	const { id } = await params
	const item = await prisma.shopItem.findUnique({ where: { id } })
	if (!item) notFound()

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
						id: item.id,
						name: item.name,
						description: item.description,
						imageUrl: item.imageUrl,
						category: item.category,
						priceCredits: item.priceCredits,
						costUsd: item.costUsd,
						requiresPrinterQualified: item.requiresPrinterQualified,
					}}
				/>
			</Panel>
		</div>
	)
}
