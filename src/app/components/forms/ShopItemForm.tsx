"use client"
import { useRef, useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import type { ShopItemCategory } from "@/app/generated/prisma/enums"
import { IMAGE_ACCEPT } from "@/lib/uploads/image-accept"
import { sendJson, useAction } from "@/lib/use-action"
import { uploadFile } from "@/lib/use-handoff"

const CATEGORIES: { value: ShopItemCategory; label: string }[] = [
	{ label: "Printer – not listed in the shop", value: "PRINTER" },
	{ label: "Printer upgrade", value: "PRINTER_UPGRADE" },
	{ label: "Consumable", value: "CONSUMABLE" },
	{ label: "Misc", value: "MISC" },
]

/** The fields an existing item is edited from. */
export interface ShopItemInitial {
	category: ShopItemCategory
	costUsd: number | null
	description: string
	id: string
	imageUrl: string | null
	name: string
	priceCredits: number
	requiresPrinterQualified: boolean
}

const blank = {
	category: "PRINTER_UPGRADE" as ShopItemCategory,
	costUsd: "",
	description: "",
	id: "",
	imageUrl: "",
	name: "",
	priceCredits: "50",
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
		return url.href.replaceAll(/[<>"']/g, c => `%${(c.codePointAt(0) ?? 0).toString(16).toUpperCase()}`)
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
					category: item.category,
					costUsd: item.costUsd === null ? "" : String(item.costUsd),
					description: item.description,
					id: item.id,
					imageUrl: item.imageUrl ?? "",
					name: item.name,
					priceCredits: String(item.priceCredits),
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
			setForm(f => ({ ...f, imageUrl: url }))
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
			category: form.category,
			costUsd: form.costUsd === "" ? null : Number(form.costUsd),
			description: form.description,
			imageUrl: form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
			name: form.name,
			priceCredits: Number(form.priceCredits),
			requiresPrinterQualified: form.requiresPrinterQualified,
		}
		void run(
			"submit",
			() =>
				sendJson(editing ? `/api/admin/shop/items/${item.id}` : "/api/admin/shop/items", {
					body: editing ? fields : { id: form.id, ...fields },
					method: editing ? "PATCH" : "POST",
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
		<form className="hl-stack hl-stack--tight" onSubmit={submit}>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{saved ? <Callout>Saved.</Callout> : null}
			<Field
				hint={
					editing
						? "Fixed once the item exists: orders and analytics refer to it."
						: "Lowercase, hyphens. Appears in analytics, so it should not change."
				}
				label="Slug"
			>
				<input
					className="hl-input hl-mono"
					onChange={e => setForm({ ...form, id: e.target.value })}
					pattern="[a-z0-9][a-z0-9-]*"
					readOnly={editing}
					required
					value={form.id}
				/>
			</Field>
			<Field label="Name">
				<input
					className="hl-input"
					onChange={e => setForm({ ...form, name: e.target.value })}
					required
					value={form.name}
				/>
			</Field>
			<Field label="Description">
				<textarea
					className="hl-textarea"
					onChange={e => setForm({ ...form, description: e.target.value })}
					required
					value={form.description}
				/>
			</Field>
			<Field hint="Printers are not listed in the shop; everything else is paid for in coins." label="Category">
				<select
					className="hl-select"
					onChange={e => setForm({ ...form, category: e.target.value as ShopItemCategory })}
					value={form.category}
				>
					{CATEGORIES.map(c => (
						<option key={c.value} value={c.value}>
							{c.label}
						</option>
					))}
				</select>
			</Field>
			<Field hint="Paste an https link, or upload one. Blank for no picture." label="Image">
				<div className="hl-row" style={{ alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
					<input
						className="hl-input"
						onChange={e => setForm({ ...form, imageUrl: e.target.value })}
						placeholder="https://…"
						style={{ flex: "1 1 16rem" }}
						type="url"
						value={form.imageUrl}
					/>
					<Button disabled={uploading} onClick={() => picker.current?.click()} type="button">
						{uploading ? "Uploading…" : "Upload"}
					</Button>
					<input
						accept={IMAGE_ACCEPT}
						hidden
						onChange={e => {
							const file = e.target.files?.[0]
							e.target.value = ""
							uploadImage(file)
						}}
						ref={picker}
						type="file"
					/>
				</div>
				{previewUrl ? (
					// A plain img, as the shop itself shows it: next/image refuses any host not listed in next.config, and a pasted link can be anywhere. eslint-disable-next-line @next/next/no-img-element -- staff paste any host into the item's image field
					<img
						alt=""
						src={previewUrl}
						style={{ height: "7rem", marginTop: "0.5rem", objectFit: "contain", width: "7rem" }}
					/>
				) : null}
			</Field>
			<Field label="Price (coins)">
				<input
					className="hl-input"
					min="0"
					onChange={e => setForm({ ...form, priceCredits: e.target.value })}
					type="number"
					value={form.priceCredits}
				/>
			</Field>
			<Field hint="Per unit, tax and shipping included. Shown on the fulfillment sheet." label="Cost to us (USD)">
				<input
					className="hl-input"
					min="0"
					onChange={e => setForm({ ...form, costUsd: e.target.value })}
					step="0.01"
					type="number"
					value={form.costUsd}
				/>
			</Field>
			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input
					checked={form.requiresPrinterQualified}
					onChange={e => setForm({ ...form, requiresPrinterQualified: e.target.checked })}
					type="checkbox"
				/>
				<span>Requires all five themes shipped</span>
			</label>
			<div>
				<Button disabled={busy !== null || uploading} type="submit" variant="primary">
					{busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create item"}
				</Button>
			</div>
		</form>
	)
}
