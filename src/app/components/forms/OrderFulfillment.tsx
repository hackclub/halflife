"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Callout } from "@/app/components/ui"
import type { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/app/generated/prisma/enums"
import { METHOD_LABELS, STAGE_LABELS } from "@/lib/fulfillment"

/** The two markings on one order, each saved the moment it changes. */
export function OrderFulfillment({
  orderId,
  method,
  stage,
  cancelled,
}: Readonly<{
  orderId: string
  method: ShopFulfillmentMethod | null
  stage: ShopFulfillmentStage
  /** Cancelled by the participant: the stage is fixed. */
  cancelled: boolean
}>) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(body: { method?: ShopFulfillmentMethod | null; stage?: ShopFulfillmentStage }) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/shop/orders/${orderId}/fulfillment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hl-stack hl-stack--tight" style={{ gap: "0.4rem" }}>
      <select
        className="hl-select"
        aria-label="Shipping method"
        value={method ?? ""}
        disabled={busy}
        onChange={(e) =>
          save({ method: e.target.value === "" ? null : (e.target.value as ShopFulfillmentMethod) })
        }
      >
        <option value="">Method not chosen</option>
        {Object.entries(METHOD_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="hl-select"
        aria-label="Fulfilment stage"
        value={stage}
        disabled={busy || cancelled}
        onChange={(e) => save({ stage: e.target.value as ShopFulfillmentStage })}
      >
        {Object.entries(STAGE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  )
}
