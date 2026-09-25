"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

export function ShopItemForm() {
  const router = useRouter()
  const [form, setForm] = useState({
    id: "",
    name: "",
    description: "",
    priceCredits: "50",
    costUsd: "",
    maxPerUser: "1",
    stock: "",
    requiresPrinterQualified: true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/shop/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.id,
          name: form.name,
          description: form.description,
          priceCredits: Number(form.priceCredits),
          costUsd: form.costUsd === "" ? null : Number(form.costUsd),
          maxPerUser: Number(form.maxPerUser),
          stock: form.stock === "" ? null : Number(form.stock),
          requiresPrinterQualified: form.requiresPrinterQualified,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      setForm({ ...form, id: "", name: "", description: "", costUsd: "" })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="hl-stack hl-stack--tight">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <Field label="Slug" hint="Lowercase, hyphens. Appears in analytics, so it should not change.">
        <input
          className="hl-input"
          value={form.id}
          required
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
      <Field label="Price">
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
      <label className="hl-row" style={{ gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={form.requiresPrinterQualified}
          onChange={(e) => setForm({ ...form, requiresPrinterQualified: e.target.checked })}
        />
        <span>Requires all five themes shipped</span>
      </label>
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Creating…" : "Create item"}
        </Button>
      </div>
    </form>
  )
}
