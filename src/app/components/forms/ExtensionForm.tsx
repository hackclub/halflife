"use client"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button, Callout } from "@/app/components/ui"

const DAY_MS = 24 * 60 * 60 * 1000

/** A Date as the value a datetime-local input takes, in the admin's own zone. */
function toLocalInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

/**
 * Grant, move or clear an extension.
 *
 * An extension reopens passed weeks for journal entries and lets the work be
 * submitted past a global close. The quick buttons count from whichever is
 * later, now or the current extension, so pressing "+1 day" twice gives two.
 */
export function ExtensionForm({
  url,
  current,
}: Readonly<{
  /** The PATCH endpoint that takes `{ submissionExtensionUntil }`. */
  url: string
  /** ISO string of the extension now on record, if any. */
  current: string | null
}>) {
  const router = useRouter()
  // Filled in after mount: the server renders in its own timezone, and the
  // input has to show the admin's.
  const [value, setValue] = useState("")
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the browser's timezone
    setValue(current ? toLocalInput(new Date(current)) : "")
  }, [current])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const active = current !== null && new Date(current) > new Date()

  async function save(until: Date | null) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionExtensionUntil: until?.toISOString() ?? null }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(payload.error?.message ?? `Failed (${res.status})`)
        return
      }
      setValue(until ? toLocalInput(until) : "")
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed")
    } finally {
      setBusy(false)
    }
  }

  function extendBy(days: number) {
    const base = active && current ? new Date(current).getTime() : Date.now()
    void save(new Date(base + days * DAY_MS))
  }

  return (
    <div className="hl-stack hl-stack--tight">
      <p className="hl-hint" style={{ margin: 0 }} suppressHydrationWarning>
        {active && current
          ? `Extended until ${new Date(current).toLocaleString()}`
          : current
            ? `Expired ${new Date(current).toLocaleString()}`
            : "No extension"}
      </p>
      <form
        className="hl-row"
        onSubmit={(e) => {
          e.preventDefault()
          if (value) void save(new Date(value))
        }}
      >
        <input
          className="hl-input"
          type="datetime-local"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Extend until"
          style={{ maxWidth: "14rem" }}
        />
        <Button type="submit" disabled={busy || !value}>
          Set
        </Button>
        <Button type="button" disabled={busy} onClick={() => extendBy(1)}>
          +1 day
        </Button>
        <Button type="button" disabled={busy} onClick={() => extendBy(3)}>
          +3 days
        </Button>
        {current ? (
          <Button type="button" variant="danger" disabled={busy} onClick={() => void save(null)}>
            Clear
          </Button>
        ) : null}
      </form>
      {error ? <Callout tone="danger">{error}</Callout> : null}
    </div>
  )
}
