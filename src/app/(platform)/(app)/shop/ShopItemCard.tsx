"use client"

import Link from "next/link"
import { Gato } from "@/components/platform/art"
import { IconCheck, IconCoin } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import type { ShopItemView } from "@/lib/shop"

interface ItemError {
	code?: string
	id: string
	message: string
}

/** One shelf item: the photo, the buy action, the price, and the refusal if this card's last try failed. */
export function ShopItemCard({
	busy,
	item,
	itemError,
	onBuy,
	printerFund,
}: {
	busy: string | null
	item: ShopItemView
	itemError: ItemError | null
	onBuy(item: ShopItemView): void
	printerFund: number
}) {
	const has = item.ownedCount > 0
	const out = item.stock !== null && item.stock <= 0
	// One pot: affordability reads the same whole balance the till does, so the shelf can never refuse what the server would take.
	const afford = printerFund >= item.priceCredits
	return (
		<Panel as="li" className="group flex flex-col overflow-hidden bg-paper" radius={20} tone="line">
			{/* The action lives under the photo on a phone and lifts onto it from sm, where a hover reveals it. A phone has no hover, so an overlaid button is always showing – and "not enough coins" over a small shelf image covered a third of the thing being bought. */}
			<div className="relative">
				{/* Capped at 30vh so a wide card cannot grow a towering photo; the image stays object-contain inside it, so it shrinks to fit rather than being cropped.
				 *
				 * The single track is `minmax(0, 1fr)` and the box clips. With an `auto` row, the image's `h-full` resolved against a row that grew to the photo's own height, so a square or portrait photo ran out of the 4:3 box and, the box being positioned, painted over the name and description under it. */}
				<div className="relative grid aspect-[4/3] max-h-[30vh] grid-cols-1 grid-rows-1 place-items-center overflow-hidden bg-cream/70 p-3">
					{/* The photo staff set on the item; until there is one, gato minding a box of parts, so the shelf never shows a hole. */}
					{item.imageUrl ? (
						// staff paste any host into the item's image field
						<img alt="" className="h-full min-h-0 w-full min-w-0 object-contain" loading="lazy" src={item.imageUrl} />
					) : (
						<Gato className="sticker-shadow h-full w-auto max-w-full" pose="box" sizes="200px" />
					)}
					{item.stock !== null && item.stock > 0 && item.stock <= 3 && (
						<span className="label absolute top-2.5 left-2.5 rounded-full bg-coral px-2.5 py-1 text-white">
							Low stock
						</span>
					)}
					{out && (
						<span className="label absolute top-2.5 left-2.5 rounded-full bg-navy-soft px-2.5 py-1 text-white">
							Sold out
						</span>
					)}
				</div>
				{has && item.locked ? (
					<Link
						className={cx(
							"label flex w-full items-center justify-center gap-1.5 border-t-2 border-teal-deep bg-teal px-3.5 py-2.5 text-white transition-all duration-150",
							"sm:absolute sm:bottom-3 sm:left-3 sm:w-auto sm:justify-start sm:rounded-xl sm:border-2 sm:py-2",
							"sm:translate-y-1.5 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 focus-visible:opacity-100",
						)}
						href="/shop/orders"
					>
						<IconCheck className="text-sm" strokeWidth={3} /> Ordered
					</Link>
				) : (
					<button
						className={cx(
							"label flex w-full items-center justify-center gap-1.5 border-t-2 px-3.5 py-2.5 transition-all duration-150",
							"sm:absolute sm:bottom-3 sm:left-3 sm:w-auto sm:justify-start sm:rounded-xl sm:border-2 sm:py-2",
							"sm:translate-y-1.5 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 focus-visible:opacity-100",
							out || !afford
								? "cursor-not-allowed border-line bg-cream text-navy-soft"
								: "border-teal-deep bg-teal-mid text-navy hover:bg-teal hover:text-white",
						)}
						disabled={out || item.locked || !afford || busy !== null}
						onClick={() => onBuy(item)}
						type="button"
					>
						{busy === item.id
							? "Ordering…"
							: out
								? "Sold out"
								: item.locked
									? "Locked"
									: !afford
										? "Not enough coins"
										: has
											? "Order another"
											: "Buy"}
					</button>
				)}
			</div>

			<div className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
				<h2 className="text-[0.98rem] leading-tight font-extrabold text-navy">{item.name}</h2>
				<p className="flex-1 text-[0.82rem] leading-snug text-navy-soft">{item.lockReason ?? item.description}</p>
				<p className="mt-1 flex items-center gap-1.5">
					<IconCoin className="text-[1.15rem] text-orange" />
					<span
						className={cx(
							"text-[1.05rem] leading-none font-extrabold tabular-nums",
							afford ? "text-navy" : "text-navy-soft",
						)}
					>
						{item.priceCredits}
					</span>
				</p>
				{itemError?.id === item.id && (
					<p
						className="mt-2 rounded-xl border-2 border-coral bg-cream px-3 py-2 text-[0.8rem] leading-snug font-semibold text-coral-deep"
						id={`shop-order-error-${item.id}`}
						role="alert"
					>
						{itemError.message}
						{itemError.code === "PURCHASE_LIMIT" && (
							<>
								{" "}
								<Link className="underline decoration-dashed underline-offset-4 hover:text-navy" href="/shop/orders">
									View your orders
								</Link>
							</>
						)}
					</p>
				)}
			</div>
		</Panel>
	)
}
