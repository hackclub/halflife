import type { Metadata } from "next"
import Link from "next/link"
import { PageSign } from "@/components/platform/PageSign"
import { requireSessionPage } from "@/lib/page-guards"
import { getShopOrdersFor } from "@/lib/shop"
import { OrdersList } from "./OrdersList"

export const metadata: Metadata = {
	description: "Everything you have spent coins on in the Half Life shop, and where each order has got to.",
	title: "Your orders · Half Life Shop",
}

export const dynamic = "force-dynamic"

export default async function ShopOrdersPage() {
	const { user } = await requireSessionPage()
	const orders = await getShopOrdersFor(user.id)

	return (
		<div className="mx-auto w-full max-w-260 px-4 pt-2 sm:px-8">
			<PageSign
				color="var(--color-orange)"
				label="YOUR ORDERS"
				sub={
					<>
						Everything you have spent coins on, and how far each order has got.{" "}
						<Link
							className="font-semibold text-navy underline decoration-dashed underline-offset-4 hover:text-coral-deep"
							href="/shop"
						>
							Back to the shop
						</Link>
						.
					</>
				}
			/>
			<OrdersList orders={orders} />
		</div>
	)
}
