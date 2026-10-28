"use client"
import { useState } from "react"
import { Button, Callout, TextInput } from "@/app/components/ui"
import { sendJson, useAction } from "@/lib/use-action"

/**
 * One region's coin price for one shop item. Blank is base pricing: the row only exists while an override does, so clearing the field deletes it and the item sells at its base price again.
 */
export function ItemRegionPrices({
	itemId,
	basePrice,
	regions,
}: {
	itemId: string
	basePrice: number
	regions: { id: string; name: string; price: number | null }[]
}) {
	const [values, setValues] = useState<{ [_: string]: string }>(() =>
		Object.fromEntries(regions.map(r => [r.id, r.price === null ? "" : String(r.price)])),
	)
	const { busy, error, run, refuse } = useAction()

	function save(regionId: string) {
		const raw = (values[regionId] ?? "").trim()
		const price = raw === "" ? null : Number(raw)
		if (price !== null && (!Number.isInteger(price) || price < 0)) {
			refuse("Prices are whole coins, zero or more, or blank for base pricing.")
			return
		}
		void run(regionId, () =>
			sendJson(`/api/admin/shop/items/${itemId}/regions`, {
				body: { priceCredits: price, regionId },
				method: "PUT",
			}),
		)
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{regions.length === 0 ? (
				<p className="hl-hint">No regions yet. Add one on the shop page first.</p>
			) : (
				<ul className="hl-stack hl-stack--tight" style={{ listStyle: "none", margin: 0, padding: 0 }}>
					{regions.map(region => (
						<li className="hl-row" key={region.id} style={{ alignItems: "end" }}>
							<span style={{ minWidth: "10rem" }}>
								<span className="hl-label-text">{region.name}</span>
								<span className="hl-hint" style={{ display: "block" }}>
									{region.price === null ? `base (${basePrice})` : `override (${region.price})`}
								</span>
							</span>
							<TextInput
								aria-label={`Price in coins for ${region.name}`}
								min="0"
								onChange={e => setValues(v => ({ ...v, [region.id]: e.target.value }))}
								placeholder={String(basePrice)}
								step="1"
								style={{ maxWidth: "9rem" }}
								type="number"
								value={values[region.id] ?? ""}
							/>
							<Button disabled={busy !== null} onClick={() => save(region.id)} type="button">
								{busy === region.id ? "Saving…" : "Save"}
							</Button>
						</li>
					))}
				</ul>
			)}
			<p className="hl-hint">Blank sells at the base price above. Orders keep the price they were charged.</p>
		</div>
	)
}
