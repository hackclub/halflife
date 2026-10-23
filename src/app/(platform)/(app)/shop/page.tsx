/* oxlint-disable import/group-exports -- Next.js reads segment config exports statically */

import type { Metadata } from "next"
import { PageSign } from "@/components/platform/PageSign"
import { PRINTER_GRANT_NOTICE, printerComesAsGrant } from "@/lib/config/printers"
import { requireSessionPage } from "@/lib/page-guards"
import { getShopItemsFor } from "@/lib/shop"
import { ShopGrid } from "./ShopGrid"

export const metadata: Metadata = {
	description:
		"Spend the coins you earned – 5 per approved hour, once the funding for your tier has been achieved – on grants, tools, parts and swag.",
	title: "Half Life Shop",
}

export const dynamic = "force-dynamic"

export default async function ShopPage() {
	const { user } = await requireSessionPage()
	const { items, regions, regionId, country } = await getShopItemsFor(user.id)

	return (
		<div className="mx-auto w-full max-w-[1040px] px-4 pt-2 sm:px-8">
			<PageSign
				color="var(--color-orange)"
				label="SHOP"
				sub={
					<>
						Don&rsquo;t see what you&rsquo;re looking for? Suggest it on the{" "}
						<a
							className="font-semibold text-navy underline decoration-dashed underline-offset-4 hover:text-coral-deep"
							href="https://hackclub.enterprise.slack.com/docs/T0266FRGM/F0C4MAYPK4H"
							rel="noopener noreferrer"
							target="_blank"
						>
							shop items canvas on Slack
						</a>
						.
					</>
				}
			/>
			{/* Where a printer is paid out as a grant rather than shipped, said here because the shop is where a maker
			    comes to spend coins and asks what happened to the machine. Rendered on the server so it costs the page
			    no client work, and keyed off the same country the notice names. */}
			{printerComesAsGrant(country) ? (
				<div className="mb-5 rounded-2xl border-2 border-dashed border-gold-deep/40 bg-gold-pale/50 px-4 py-3">
					<p className="label mb-1 text-gold-ink">Printers in {country}</p>
					<p className="text-[0.88rem] leading-relaxed text-navy-soft">{PRINTER_GRANT_NOTICE}</p>
				</div>
			) : null}
			<ShopGrid items={items} regionId={regionId} regions={regions} />
		</div>
	)
}
