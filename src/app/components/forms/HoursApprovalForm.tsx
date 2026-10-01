"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Callout } from "@/app/components/ui"

type Kind = "session" | "hackatime"

/**
 * Approve one entry's hours, which is what `WorkSession.hoursApproved` and
 * `HackatimeLink.hoursApproved` exist for: a reviewer deflating one bad entry
 * before the phase total is computed from it.
 *
 * Only rendered while the reviewer holds the claim, because the route refuses
 * a batch another reviewer's live claim covers — showing the field without a
 * claim would be an input that always errors.
 */
export function HoursApprovalForm(
  props: Readonly<{ kind: Kind; id: string; claimed: boolean; approved: number | null }>,
) {
  if (!props.claimed) return null
  return <HoursApprovalFormInner {...props} />
}

function HoursApprovalFormInner({ kind, id, approved }: Readonly<{ kind: Kind; id: string; approved: number | null }>) {
  const router = useRouter()
  const [value, setValue] = useState(approved === null ? "" : String(approved))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const hoursApproved = Number(value)
    if (value.trim() === "" || !Number.isFinite(hoursApproved) || hoursApproved < 0) {
      setError("Enter a number of hours")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/review/hours", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: [{ kind, id, hoursApproved }] }),
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
    <form
      className="hl-stack hl-stack--tight"
      style={{ gap: "0.3rem", minWidth: "6rem" }}
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <input
        className="hl-input"
        type="number"
        min={0}
        max={kind === "session" ? 24 : 2000}
        step={0.25}
        aria-label="Approved hours"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
      />
      <button className="hl-btn" type="submit" disabled={busy}>
        Save
      </button>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </form>
  )
}
