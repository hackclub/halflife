"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

export function OrderDecision({ orderId }: Readonly<{ orderId: string }>) {
  const router = useRouter()
  const [action, setAction] = useState<"FULFILL" | "REJECT" | "HOLD">("FULFILL")
  const [tracking, setTracking] = useState("")
  const [carrier, setCarrier] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body =
        action === "FULFILL"
          ? {
              action,
              trackingNumber: tracking || undefined,
              trackingCarrier: carrier || undefined,
            }
          : { action, reason }
      const res = await fetch(`/api/admin/shop/orders/${orderId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="hl-stack hl-stack--tight">
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <select className="hl-select" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
        <option value="FULFILL">Fulfil</option>
        <option value="REJECT">Reject and refund</option>
        <option value="HOLD">Put on hold</option>
      </select>
      {action === "FULFILL" ? (
        <>
          <Field label="Carrier">
            <input className="hl-input" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
          </Field>
          <Field label="Tracking number">
            <input className="hl-input" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          </Field>
        </>
      ) : (
        <Field label="Reason" hint="Shown to the participant.">
          <input className="hl-input" value={reason} required onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Working…" : "Apply"}
        </Button>
      </div>
    </form>
  )
}
