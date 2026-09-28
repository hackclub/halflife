"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Button, Callout, Field } from "@/app/components/ui"

export function ProgramSettingsForm({
  initial,
}: Readonly<{
  initial: {
    programTimezone: string
    submissionsOpen: boolean
    shopOpen: boolean
    shopGraceDays: number
    reviewClaimTtlMinutes: number
    airtableSyncEnabled: boolean
  }
}>) {
  const router = useRouter()
  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch("/api/admin/program", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // The start date has its own form (ProgramStartForm): moving it moves
        // every week's lock, so it is not something to change in passing.
        body: JSON.stringify({
          programTimezone: form.programTimezone,
          submissionsOpen: form.submissionsOpen,
          shopOpen: form.shopOpen,
          shopGraceDays: Number(form.shopGraceDays),
          reviewClaimTtlMinutes: Number(form.reviewClaimTtlMinutes),
          airtableSyncEnabled: form.airtableSyncEnabled,
        }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      setSaved(true)
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

      <Field label="Timezone" hint="Used for week boundaries and journal dates.">
        <input
          className="hl-input"
          value={form.programTimezone}
          onChange={(e) => setForm({ ...form, programTimezone: e.target.value })}
        />
      </Field>

      <label className="hl-row" style={{ gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={form.submissionsOpen}
          onChange={(e) => setForm({ ...form, submissionsOpen: e.target.checked })}
        />
        <span>Submissions open</span>
      </label>

      <label className="hl-row" style={{ gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={form.shopOpen}
          onChange={(e) => setForm({ ...form, shopOpen: e.target.checked })}
        />
        <span>Shop open</span>
      </label>

      <label className="hl-row" style={{ gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={form.airtableSyncEnabled}
          onChange={(e) => setForm({ ...form, airtableSyncEnabled: e.target.checked })}
        />
        <span>Push approvals to Airtable</span>
      </label>

      <Field label="Shop grace days" hint="How long the shop stays open after someone's last review.">
        <input
          className="hl-input"
          type="number"
          min="0"
          max="90"
          value={form.shopGraceDays}
          onChange={(e) => setForm({ ...form, shopGraceDays: Number(e.target.value) })}
        />
      </Field>

      <Field label="Review claim TTL (minutes)">
        <input
          className="hl-input"
          type="number"
          min="5"
          max="240"
          value={form.reviewClaimTtlMinutes}
          onChange={(e) => setForm({ ...form, reviewClaimTtlMinutes: Number(e.target.value) })}
        />
      </Field>

      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  )
}
