import type { Metadata } from "next"
import Link from "next/link"
import { GrantCardMerchantsPanel } from "@/app/components/forms/GrantCardMerchantsPanel"
import { PageHeader } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"

export const metadata: Metadata = {
	title: "Grant card merchants",
}

export const dynamic = "force-dynamic"

/** The grant card merchants: each vendor's IDs, entered once and linked to the shop items it sells. */
export default async function AdminGrantCardMerchantsPage() {
	await requirePermissionPage(Permission.MANAGE_SHOP)
	const [merchants, links] = await Promise.all([
		db.orm.public.GrantCardMerchant.orderBy(merchant => merchant.name.asc()).all(),
		db.orm.public.ShopItemGrantCardMerchant.select("merchantId").all(),
	])
	const counts = new Map<string, number>()
	for (const link of links) counts.set(link.merchantId, (counts.get(link.merchantId) ?? 0) + 1)

	return (
		<div className="hl-stack">
			<p>
				<Link href="/admin/shop">← Shop items</Link>
			</p>
			<PageHeader compact title="Grant card merchants" />
			<p className="hl-hint" style={{ margin: 0 }}>
				A grant card for an item may be spent at any merchant linked to that item. Each merchant's IDs are entered once
				here, not on each item.
			</p>
			<GrantCardMerchantsPanel
				merchants={merchants.map(merchant => ({
					id: merchant.id,
					itemCount: counts.get(merchant.id) ?? 0,
					merchantIds: merchant.merchantIds,
					name: merchant.name,
					sourceNote: merchant.sourceNote,
				}))}
			/>
		</div>
	)
}
