"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout } from "@/app/components/ui"

/** Set what one unit of an item costs Hack Club, from the catalogue row. */
export function ItemCostField({ itemId, costUsd }: Readonly<{ itemId: string; costUsd: number | null }>) {
  const router = useRouter()
  const [value, setValue] = useState(costUsd === null ? "" : String(costUsd))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = value !== (costUsd === null ? "" : String(costUsd))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/shop/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costUsd: value === "" ? null : Number(value) }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="hl-row" style={{ gap: "0.4rem", flexWrap: "nowrap" }}>
      <input
        className="hl-input"
        type="number"
        min="0"
        step="0.01"
        aria-label="Cost in USD"
        placeholder="not set"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        style={{ width: "7rem" }}
      />
      {dirty ? (
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      ) : null}
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </form>
  )
}
