import type { Metadata, Route } from "next"
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

const TABS = [
	{ archived: false, href: "/admin/shop/merchants", label: "Active" },
	{ archived: true, href: "/admin/shop/merchants?tab=archived", label: "Archived" },
] as const

/** The grant card merchants: each vendor's IDs, entered once and linked to the shop items it sells. Archived ones are kept, but cannot be linked. */
export default async function AdminGrantCardMerchantsPage({
	searchParams,
}: {
	searchParams: Promise<{ tab?: string | string[] }>
}) {
	await requirePermissionPage(Permission.MANAGE_SHOP)
	const { tab } = await searchParams
	const archived = tab === "archived"
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
			<div className="hl-chips">
				{TABS.map(item => (
					<Link
						aria-current={item.archived === archived || undefined}
						className="hl-chip"
						href={item.href as Route}
						key={item.label}
					>
						{item.label}
					</Link>
				))}
			</div>
			<p className="hl-hint" style={{ margin: 0 }}>
				A grant card for an item may be spent at any merchant linked to that item. Each merchant's IDs are entered once
				here, not on each item.
			</p>
			<GrantCardMerchantsPanel
				archived={archived}
				merchants={merchants
					.filter(merchant => (merchant.archivedAt !== null) === archived)
					.map(merchant => ({
						archived: merchant.archivedAt !== null,
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
