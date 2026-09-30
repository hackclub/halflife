"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

export function CreditGrantForm({ userId }: Readonly<{ userId: string }>) {
  const router = useRouter()
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, amount: Number(amount), reason }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      setAmount("")
      setReason("")
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
      <Field label="Amount" hint="Negative to claw back.">
        <input className="hl-input" type="number" value={amount} required onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason" hint="Recorded in the ledger and the audit log.">
        <input
          className="hl-input"
          value={reason}
          required
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <div>
        <Button type="submit" disabled={busy || !amount || !reason}>
          {busy ? "Applying…" : "Apply adjustment"}
        </Button>
      </div>
    </form>
  )
}
