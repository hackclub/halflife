"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"

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
	const router = useRouter()
	const [values, setValues] = useState<Record<string, string>>(() =>
		Object.fromEntries(regions.map((r) => [r.id, r.price === null ? "" : String(r.price)])),
	)
	const [busy, setBusy] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	async function save(regionId: string) {
		const raw = (values[regionId] ?? "").trim()
		const price = raw === "" ? null : Number(raw)
		if (price !== null && (!Number.isInteger(price) || price < 0)) {
			setError("Prices are whole coins, zero or more – or blank for base pricing.")
			return
		}
		setBusy(regionId)
		setError(null)
		try {
			const res = await fetch(`/api/admin/shop/items/${itemId}/regions`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ regionId, priceCredits: price }),
			})
			if (!res.ok) {
				const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
				setError(payload.error?.message ?? `Failed (${res.status})`)
				return
			}
			router.refresh()
		} catch {
			setError("Could not reach the server")
		} finally {
			setBusy(null)
		}
	}

	return (
		<div className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{regions.length === 0 ? (
				<p className="hl-hint">No regions yet – add one on the shop page first.</p>
			) : (
				<ul className="hl-stack hl-stack--tight" style={{ listStyle: "none", padding: 0, margin: 0 }}>
					{regions.map((region) => (
						<li key={region.id} className="hl-row" style={{ alignItems: "end" }}>
							<span style={{ minWidth: "10rem" }}>
								<span className="hl-label-text">{region.name}</span>
								<span className="hl-hint" style={{ display: "block" }}>
									{region.price === null ? `base (${basePrice})` : `override (${region.price})`}
								</span>
							</span>
							<input
								className="hl-input"
								type="number"
								min="0"
								step="1"
								placeholder={String(basePrice)}
								aria-label={`Price in coins for ${region.name}`}
								value={values[region.id] ?? ""}
								onChange={(e) => setValues((v) => ({ ...v, [region.id]: e.target.value }))}
								style={{ maxWidth: "9rem" }}
							/>
							<Button type="button" disabled={busy !== null} onClick={() => void save(region.id)}>
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
