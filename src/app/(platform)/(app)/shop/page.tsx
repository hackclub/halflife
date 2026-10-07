import type { Metadata } from "next"
import { PageSign } from "@/components/platform/PageSign"
import { requireSessionPage } from "@/lib/page-guards"
import { getShopItemsFor } from "@/lib/shop"
import { ShopGrid } from "./ShopGrid"

export const metadata: Metadata = {
	title: "Half Life Shop",
	description: "Spend the coins you banked on grants, tools, parts and swag.",
}

export const dynamic = "force-dynamic"

export default async function ShopPage() {
	const { user } = await requireSessionPage()
	const { items, regions, regionId } = await getShopItemsFor(user.id)

	return (
		<div className="mx-auto w-full max-w-[1040px] px-4 pt-2 sm:px-8">
			<PageSign
				label="SHOP"
				color="var(--color-orange)"
				sub={
					<>
						Don&rsquo;t see what you&rsquo;re looking for? Suggest it on the{" "}
						<a
							href="https://hackclub.enterprise.slack.com/docs/T0266FRGM/F0C4MAYPK4H"
							target="_blank"
							rel="noopener noreferrer"
							className="font-semibold text-navy underline decoration-dashed underline-offset-4 hover:text-coral-deep"
						>
							shop items canvas on Slack
						</a>
						.
					</>
				}
			/>
			<ShopGrid items={items} regions={regions} regionId={regionId} />
		</div>
	)
}
