"use client"

import { useRouter } from "next/navigation"
import { useMemo, useRef, useState } from "react"
import { Gato } from "@/components/platform/art"
import { IconCheck, IconCoin } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { cx } from "@/lib/cx"
import type { ShopItemView } from "@/lib/shop"
import { useStore } from "@/lib/store"

/**
 * The shelves, in the order they read on screen. Every item on them is paid
 * for out of the whole balance – every coin is spendable on anything.
 */
const CATEGORIES = [
	{ label: "All", match: null },
	{ label: "Upgrades", match: "PRINTER_UPGRADE" },
	{ label: "Consumables", match: "CONSUMABLE" },
	{ label: "Everything else", match: "MISC" },
] as const

export function ShopGrid({
	items: all,
	regions,
	regionId,
}: {
	items: readonly ShopItemView[]
	regions: { id: string; name: string }[]
	regionId: string | null
}) {
	const router = useRouter()
	const { printerFund } = useStore()
	const [cat, setCat] = useState<string>("All")
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [savingRegion, setSavingRegion] = useState(false)
	// One key per item until it sells, so a retry replays the same purchase instead of minting a second order.
	const keys = useRef(new Map<string, string>())

	const items = useMemo(() => {
		const shelf = CATEGORIES.find(c => c.label === cat)
		return !shelf?.match ? all : all.filter(i => i.category === shelf.match)
	}, [all, cat])

	/**
	 * Buying is a request, not a transaction the browser can settle.
	 *
	 * The server takes the coins inside one locked transaction and the order lands PENDING for someone to fulfil, so there is nothing to do optimistically here beyond refusing to double-fire – a second click while the first is in the air is how somebody ends up with two printers.
	 */
	async function buy(item: ShopItemView) {
		if (busy) return
		setBusy(item.id)
		setError(null)
		try {
			const key = keys.current.get(item.id) ?? crypto.randomUUID()
			keys.current.set(item.id, key)
			const res = await fetch("/api/shop/orders", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ shopItemId: item.id, quantity: 1, idempotencyKey: key }),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as {
					error?: { message?: string }
				}
				setError(payload.error?.message ?? `That did not go through (${res.status})`)
				return
			}
			keys.current.delete(item.id)
			router.refresh()
		} catch {
			setError("That did not go through")
		} finally {
			setBusy(null)
		}
	}

	return (
		<>
			{regions.length > 0 && (
				<div className="mb-5 flex flex-wrap items-center justify-center gap-2">
					<label className="label text-navy-soft" htmlFor="shop-region">
						Prices for
					</label>
					<select
						className="label rounded-full border-2 border-line bg-paper px-4 py-1.5 text-navy outline-none transition-colors hover:border-navy focus:border-navy disabled:opacity-60"
						disabled={savingRegion}
						id="shop-region"
						onChange={e => {
							const next = e.target.value === "" ? null : e.target.value
							setSavingRegion(true)
							setError(null)
							fetch("/api/shop/region", {
								method: "PUT",
								headers: { "content-type": "application/json" },
								body: JSON.stringify({ regionId: next }),
							})
								.then(async res => {
									if (!res.ok) {
										const payload = (await res.json().catch(() => ({}))) as {
											error?: { message?: string }
										}
										setError(payload.error?.message ?? "That region did not save")
										return
									}
									router.refresh()
								})
								.catch(() => setError("That region did not save"))
								.finally(() => setSavingRegion(false))
						}}
						value={regionId ?? ""}
					>
						<option value="">Default pricing</option>
						{regions.map(r => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</select>
				</div>
			)}
			<div className="mb-6 flex flex-wrap items-center justify-center gap-2">
				{CATEGORIES.map(({ label: c }) => (
					<button
						aria-pressed={cat === c}
						className={cx(
							"label rounded-full border-2 px-4 py-1.5 transition-colors",
							cat === c
								? "border-navy bg-navy text-white"
								: "border-line text-navy-soft hover:border-navy hover:text-navy",
						)}
						key={c}
						onClick={() => setCat(c)}
						type="button"
					>
						{c}
					</button>
				))}
			</div>

			{error && (
				<p
					className="mb-5 rounded-xl border-2 border-coral bg-cream px-4 py-3 text-[0.9rem] font-semibold text-coral-deep"
					role="alert"
				>
					{error}
				</p>
			)}

			<ul className="grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-3">
				{items.map(item => {
					const has = item.ownedCount > 0
					const out = item.stock !== null && item.stock <= 0
					// One pot: affordability reads the same whole balance the till does, so the shelf can never refuse what the server would take.
					const afford = printerFund >= item.priceCredits
					return (
						<Panel
							as="li"
							className="group flex flex-col overflow-hidden bg-paper"
							key={item.id}
							radius={20}
							tone="line"
						>
							{/* The action lives under the photo on a phone and lifts onto it
                  from sm, where a hover reveals it. A phone has no hover, so an
                  overlaid button is always showing – and "not enough coins" over
                  a small shelf image covered a third of the thing being bought. */}
							<div className="relative">
								<div className="relative grid aspect-[4/3] place-items-center bg-cream/70 p-3">
									{/* The photo staff set on the item; until there is one, gato
                      minding a box of parts, so the shelf never shows a hole. */}
									{item.imageUrl ? (
										// eslint-disable-next-line @next/next/no-img-element -- staff paste any host into the item's image field
										<img alt="" className="h-full w-full object-contain" loading="lazy" src={item.imageUrl} />
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
								<button
									className={cx(
										"label flex w-full items-center justify-center gap-1.5 border-t-2 px-3.5 py-2.5 transition-all duration-150",
										"sm:absolute sm:bottom-3 sm:left-3 sm:w-auto sm:justify-start sm:rounded-xl sm:border-2 sm:py-2",
										"sm:translate-y-1.5 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:translate-y-0 sm:group-focus-within:opacity-100 focus-visible:opacity-100",
										has
											? "border-teal-deep bg-teal text-white"
											: out || !afford
												? "cursor-not-allowed border-line bg-cream text-navy-soft"
												: "border-teal-deep bg-teal-mid text-navy hover:bg-teal hover:text-white",
									)}
									disabled={out || item.locked || !afford || busy !== null}
									onClick={() => buy(item)}
									type="button"
								>
									{busy === item.id ? (
										"Ordering…"
									) : has ? (
										<>
											<IconCheck className="text-sm" strokeWidth={3} /> Ordered
										</>
									) : out ? (
										"Sold out"
									) : item.locked ? (
										"Locked"
									) : afford ? (
										"Buy"
									) : (
										"Not enough coins"
									)}
								</button>
							</div>

							<div className="flex flex-1 flex-col gap-1.5 px-4 py-3.5">
								<h2 className="text-[0.98rem] leading-tight font-extrabold text-navy">{item.name}</h2>
								<p className="flex-1 text-[0.82rem] leading-snug text-navy-soft">
									{item.lockReason ?? item.description}
								</p>
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
							</div>
						</Panel>
					)
				})}
			</ul>

			<p className="hand mt-8 text-center text-[0.86rem] text-navy-soft">
				you have <span className="font-bold text-orange-ink tabular-nums">{printerFund}</span> coins.
			</p>
		</>
	)
}
