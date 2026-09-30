"use client"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"
import type { ShopItemCategory } from "@/app/generated/prisma/enums"
import { uploadFile } from "@/lib/use-handoff"

const CATEGORIES: { value: ShopItemCategory; label: string }[] = [
  { value: "PRINTER", label: "Printer — the only category banked coins can buy" },
  { value: "PRINTER_UPGRADE", label: "Printer upgrade" },
  { value: "CONSUMABLE", label: "Consumable" },
  { value: "MISC", label: "Misc" },
]

/** The fields an existing item is edited from. */
export interface ShopItemInitial {
  id: string
  name: string
  description: string
  imageUrl: string | null
  category: ShopItemCategory
  priceCredits: number
  costUsd: number | null
  maxPerUser: number
  stock: number | null
  requiresPrinterQualified: boolean
  sortOrder: number
}

const blank = {
  id: "",
  name: "",
  description: "",
  imageUrl: "",
  category: "PRINTER_UPGRADE" as ShopItemCategory,
  priceCredits: "50",
  costUsd: "",
  maxPerUser: "1",
  stock: "",
  requiresPrinterQualified: true,
  sortOrder: "0",
}

/**
 * Add a shop item, or edit one when `item` is given. Every field the API
 * takes is here; the slug is fixed once an item exists, because orders and
 * analytics refer to it.
 */
export function ShopItemForm({ item }: { item?: ShopItemInitial }) {
  const router = useRouter()
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
          maxPerUser: String(item.maxPerUser),
          stock: item.stock === null ? "" : String(item.stock),
          requiresPrinterQualified: item.requiresPrinterQualified,
          sortOrder: String(item.sortOrder),
        }
      : blank,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [uploading, setUploading] = useState(false)
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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    const fields = {
      name: form.name,
      description: form.description,
      imageUrl: form.imageUrl.trim() === "" ? null : form.imageUrl.trim(),
      category: form.category,
      priceCredits: Number(form.priceCredits),
      costUsd: form.costUsd === "" ? null : Number(form.costUsd),
      maxPerUser: Number(form.maxPerUser),
      stock: form.stock === "" ? null : Number(form.stock),
      requiresPrinterQualified: form.requiresPrinterQualified,
      sortOrder: Number(form.sortOrder) || 0,
    }
    try {
      const res = await fetch(editing ? `/api/admin/shop/items/${item.id}` : "/api/admin/shop/items", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? fields : { id: form.id, ...fields }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      if (editing) setSaved(true)
      else setForm(blank)
      router.refresh()
    } catch {
      setError("Could not reach the server")
    } finally {
      setBusy(false)
    }
  }

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
      <Field label="Category" hint="Decides which coins can pay for it: banked coins only ever buy a printer.">
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
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              void uploadImage(file)
            }}
          />
        </div>
        {/^https:\/\//i.test(form.imageUrl.trim()) ? (
          // A plain img, as the shop itself shows it: next/image refuses any
          // host not listed in next.config, and a pasted link can be anywhere.
          // eslint-disable-next-line @next/next/no-img-element -- staff paste any host into the item's image field
          <img
            src={form.imageUrl.trim()}
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
      <Field label="Max per person" hint="0 for unlimited.">
        <input
          className="hl-input"
          type="number"
          min="0"
          value={form.maxPerUser}
          onChange={(e) => setForm({ ...form, maxPerUser: e.target.value })}
        />
      </Field>
      <Field label="Stock" hint="Blank for unlimited.">
        <input
          className="hl-input"
          type="number"
          min="0"
          value={form.stock}
          onChange={(e) => setForm({ ...form, stock: e.target.value })}
        />
      </Field>
      <Field label="Order in the shop" hint="Lower comes first; ties go by name.">
        <input
          className="hl-input"
          type="number"
          value={form.sortOrder}
          onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
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
        <Button type="submit" variant="primary" disabled={busy || uploading}>
          {busy ? (editing ? "Saving…" : "Creating…") : editing ? "Save changes" : "Create item"}
        </Button>
      </div>
    </form>
  )
}
