"use client"
import { useRef, useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import type { ShopItemCategory } from "@/app/generated/prisma/enums"
import { IMAGE_ACCEPT } from "@/lib/uploads/image-accept"
import { sendJson, useAction } from "@/lib/use-action"
import { uploadFile } from "@/lib/use-handoff"

const CATEGORIES: { value: ShopItemCategory; label: string }[] = [
	{ value: "PRINTER", label: "Printer – not listed in the shop" },
	{ value: "PRINTER_UPGRADE", label: "Printer upgrade" },
	{ value: "CONSUMABLE", label: "Consumable" },
	{ value: "MISC", label: "Misc" },
]

/** The fields an existing item is edited from. */
export type ShopItemInitial = {
	id: string
	name: string
	description: string
	imageUrl: string | null
	category: ShopItemCategory
	priceCredits: number
	costUsd: number | null
	requiresPrinterQualified: boolean
}

const blank = {
	id: "",
	name: "",
	description: "",
	imageUrl: "",
	category: "PRINTER_UPGRADE" as ShopItemCategory,
	priceCredits: "50",
	costUsd: "",
	requiresPrinterQualified: true,
}

/**
 * The preview URL for the image field, or null when the value is not an https URL yet.
 *
 * React escapes attribute values and `<img src>` never executes `javascript:` or an SVG payload, so the raw value was not an XSS hole – but CodeQL cannot see either fact. `js/xss-through-dom` sees a DOM read (`e.target.value`) reach a `src` write and reports it, because the guards it recognises are `DomBasedXss::Sanitizer`, not a `/^https:\/\//` test. The global `.replace` of HTML meta-characters below is one of them (`Xss.qll`'s `MetacharEscapeSanitizer`); parse first to pin the scheme, then escape.
 *
 * These characters do not belong in a URL literally, and percent-encoding them (rather than `encodeURI`, which would also re-encode an existing `%20` into `%2520`) leaves ordinary URLs, query strings and all, exactly as they were.
 */
function previewImageUrl(value: string): string | null {
	try {
		const url = new URL(value.trim())
		if (url.protocol !== "https:") return null
		return url.href.replace(/[<>"']/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
	} catch {
		return null
	}
}

/**
 * Add a shop item, or edit one when `item` is given. The slug is fixed once an item exists, because orders and analytics refer to it. Per-person limit, stock and shelf order are left to their defaults (one per person, unlimited stock, first) and an edit never sends them, so an item that already has them keeps them.
 */
export function ShopItemForm({ item }: { item?: ShopItemInitial }) {
	const editing = item !== undefined
	const [form, setForm] = useState(
		item
			? {
					id: item.id,
					name: item.name,
					description: item.description,
					imageUrl: item.imageUrl ?? "",
					category: item.category,
					priceCredits: String(item.priceCredits),
					costUsd: item.costUsd === null ? "" : String(item.costUsd),
					requiresPrinterQualified: item.requiresPrinterQualified,
				}
			: blank,
	)
	const [saved, setSaved] = useState(false)
	const [uploading, setUploading] = useState(false)
	const { busy, error, run, setError } = useAction()
	const picker = useRef<HTMLInputElement>(null)

	async function uploadImage(file: File | undefined) {
		if (!file) return
		setUploading(true)
		setError(null)
		try {
			const { url } = await uploadFile(file, "shop")
			if (!url) throw new Error("Uploads have no public URL on this deployment (S3_PUBLIC_URL)")
			setForm((f) => ({ ...f, imageUrl: url }))
		} catch (err) {
			setError(err instanceof Error ? err.message : "The image did not upload")
		} finally {
			setUploading(false)
		}
	}

	function submit(e: React.FormEvent) {
		e.preventDefault()
		setSaved(false)
		const fields = {
			name: form.name,
			description: form.description,
			imageUrl: form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
			category: form.category,
			priceCredits: Number(form.priceCredits),
			costUsd: form.costUsd === "" ? null : Number(form.costUsd),
			requiresPrinterQualified: form.requiresPrinterQualified,
		}
		void run(
			"submit",
			() =>
				sendJson(editing ? `/api/admin/shop/items/${item.id}` : "/api/admin/shop/items", {
					method: editing ? "PATCH" : "POST",
					body: editing ? fields : { id: form.id, ...fields },
				}),
			() => {
				// An edit stays on the page; a create clears for the next one.
				if (editing) setSaved(true)
				else setForm(blank)
			},
		)
	}

	const previewUrl = previewImageUrl(form.imageUrl)

	return (
		<form onSubmit={submit} className="hl-stack hl-stack--tight">
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{saved ? <Callout>Saved.</Callout> : null}
			<Field
				label="Slug"
				hint={
					editing
						? "Fixed once the item exists: orders and analytics refer to it."
						: "Lowercase, hyphens. Appears in analytics, so it should not change."
				}
			>
				<input
					className="hl-input hl-mono"
					value={form.id}
					required
					readOnly={editing}
					pattern="[a-z0-9][a-z0-9-]*"
					onChange={(e) => setForm({ ...form, id: e.target.value })}
				/>
			</Field>
			<Field label="Name">
				<input
					className="hl-input"
					value={form.name}
					required
					onChange={(e) => setForm({ ...form, name: e.target.value })}
				/>
			</Field>
			<Field label="Description">
				<textarea
					className="hl-textarea"
					value={form.description}
					required
					onChange={(e) => setForm({ ...form, description: e.target.value })}
				/>
			</Field>
			<Field label="Category" hint="Printers are not listed in the shop; everything else is paid for in coins.">
				<select
					className="hl-select"
					value={form.category}
					onChange={(e) => setForm({ ...form, category: e.target.value as ShopItemCategory })}
				>
					{CATEGORIES.map((c) => (
						<option key={c.value} value={c.value}>
							{c.label}
						</option>
					))}
				</select>
			</Field>
			<Field label="Image" hint="Paste an https link, or upload one. Blank for no picture.">
				<div className="hl-row" style={{ gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
					<input
						className="hl-input"
						type="url"
						placeholder="https://…"
						value={form.imageUrl}
						style={{ flex: "1 1 16rem" }}
						onChange={(e) => setForm({ ...form, imageUrl: e.target.value })}
					/>
					<Button type="button" disabled={uploading} onClick={() => picker.current?.click()}>
						{uploading ? "Uploading…" : "Upload"}
					</Button>
					<input
						ref={picker}
						type="file"
						accept={IMAGE_ACCEPT}
						hidden
						onChange={(e) => {
							const file = e.target.files?.[0]
							e.target.value = ""
							uploadImage(file)
						}}
					/>
				</div>
				{previewUrl ? (
					// A plain img, as the shop itself shows it: next/image refuses any host not listed in next.config, and a pasted link can be anywhere. eslint-disable-next-line @next/next/no-img-element -- staff paste any host into the item's image field
					<img
						src={previewUrl}
						alt=""
						style={{ width: "7rem", height: "7rem", objectFit: "contain", marginTop: "0.5rem" }}
					/>
				) : null}
			</Field>
			<Field label="Price (coins)">
				<input
					className="hl-input"
					type="number"
					min="0"
					value={form.priceCredits}
					onChange={(e) => setForm({ ...form, priceCredits: e.target.value })}
				/>
			</Field>
			<Field label="Cost to us (USD)" hint="Per unit, tax and shipping included. Shown on the fulfillment sheet.">
				<input
					className="hl-input"
					type="number"
					min="0"
					step="0.01"
					value={form.costUsd}
					onChange={(e) => setForm({ ...form, costUsd: e.target.value })}
				/>
			</Field>
			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input
					type="checkbox"
					checked={form.requiresPrinterQualified}
					onChange={(e) => setForm({ ...form, requiresPrinterQualified: e.target.checked })}
				/>
				<span>Requires all five themes shipped</span>
			</label>
			<div>
				<Button type="submit" variant="primary" disabled={busy !== null || uploading}>
					{busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create item"}
				</Button>
			</div>
		</form>
	)
}
