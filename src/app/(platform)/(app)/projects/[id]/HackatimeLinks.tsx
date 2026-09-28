"use client"

import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { IconClock, IconPlus, IconWarning, IconX } from "@/components/platform/icons"
import { Button, cx, inputClass, Panel } from "@/components/platform/ui"
import { linkHackatime } from "@/lib/auth-client"
import { fmtHours } from "@/lib/projects"
import type { Phase } from "@/lib/types"

interface Link {
  id: string
  hackatimeProject: string
  phase: "DESIGN" | "BUILD"
  hours: number
  hoursApproved: number | null
  lastFetchError: string | null
}

type Account =
  | { state: "loading" }
  | { state: "unlinked" }
  | { state: "linked"; projects: { name: string; totalSeconds: number }[] }
  | { state: "error" }

async function read<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw Object.assign(new Error(body?.error?.message ?? "Something went wrong"), {
      code: body?.error?.code as string | undefined,
    })
  }
  return body as T
}

/**
 * Hours that came from the editor rather than the journal.
 *
 * Firmware and CAD scripting are tracked by Hackatime, and a link here is what
 * folds that time into the week — the trail reads it back as off-book hours on
 * the next snapshot, which is why every change ends in a refresh rather than a
 * local patch. The journal is still the evidence; this is only the clock.
 *
 * A link a reviewer has already put hours on cannot be removed: those hours
 * are part of a decision, and the route refuses it, so the button does too.
 */
export function HackatimeLinks({ projectId, phase }: { projectId: string; phase: Phase }) {
  const router = useRouter()
  const [links, setLinks] = useState<Link[] | null>(null)
  const [account, setAccount] = useState<Account>({ state: "loading" })
  const [picked, setPicked] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [linksRes, projectsRes] = await Promise.all([
        fetch(`/api/projects/${projectId}/hackatime`, { cache: "no-store" }),
        fetch("/api/hackatime/projects", { cache: "no-store" }),
      ])
      try {
        setLinks((await read<{ links: Link[] }>(linksRes)).links)
      } catch (err) {
        setError((err as Error).message)
        setLinks([])
      }
      try {
        const { projects } = await read<{ projects: { name: string; totalSeconds: number }[] }>(projectsRes)
        setAccount({ state: "linked", projects })
      } catch (err) {
        if ((err as { code?: string }).code === "HACKATIME_NOT_LINKED") setAccount({ state: "unlinked" })
        else {
          setAccount({ state: "linked", projects: [] })
          setError((err as Error).message)
        }
      }
    } catch (err) {
      // The requests never produced a response at all (offline, DNS, abort).
      // Both reads are unusable, so fail visibly with a retry rather than
      // leaving the panel on "checking hackatime…" forever.
      console.error("[hackatime] failed to load links/account:", err)
      setLinks([])
      setAccount({ state: "error" })
      setError("Could not reach Hackatime. Check your connection and try again.")
    }
  }, [projectId])

  /** Retry after a total load failure: show the spinner again, then re-fetch. */
  const retry = useCallback(() => {
    setError(null)
    setLinks(null)
    setAccount({ state: "loading" })
    void load()
  }, [load])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount
    void load()
  }, [load])

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    setError(null)
    try {
      await fn()
      await load()
      router.refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const link = () =>
    run("link", async () => {
      await read(
        await fetch(`/api/projects/${projectId}/hackatime`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            hackatimeProject: picked,
            phase: phase === "build" ? "BUILD" : "DESIGN",
          }),
        }),
      )
      setPicked("")
    })

  const unlink = (id: string) =>
    run(id, async () => {
      await read(await fetch(`/api/projects/${projectId}/hackatime/${id}`, { method: "DELETE" }))
    })

  const linkedNames = new Set(links?.map((l) => l.hackatimeProject))
  const available = account.state === "linked" ? account.projects.filter((p) => !linkedNames.has(p.name)) : []

  return (
    <>
      <h2 className="label mt-8 mb-3 text-violet-deep">Hackatime</h2>
      <Panel tone="line" radius={18} className="bg-paper px-5 py-5 sm:px-6">
        <p className="max-w-[62ch] text-[0.9rem] leading-snug text-navy-soft">
          Code hours count too: link the Hackatime project you wrote them in.
        </p>

        {error && account.state !== "error" && (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl bg-coral/10 px-3.5 py-2.5 text-[0.85rem] font-semibold text-coral-deep"
          >
            <IconWarning className="mt-0.5 shrink-0 text-base" /> {error}
          </p>
        )}

        {links === null || account.state === "loading" ? (
          <p className="hand mt-4 text-[0.84rem] text-navy-soft" aria-live="polite">
            checking hackatime…
          </p>
        ) : account.state === "error" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={retry} disabled={busy !== null}>
              Try again
            </Button>
            <span role="alert" className="hand text-[0.84rem] text-coral-deep">
              {error ?? "Hackatime could not be loaded."}
            </span>
          </div>
        ) : (
          <>
            {links.length > 0 && (
              <ul className="mt-4 grid gap-2">
                {links.map((l) => (
                  <li
                    key={l.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-cream px-3.5 py-2.5"
                  >
                    <span className="min-w-0 flex-1 truncate font-bold text-navy">{l.hackatimeProject}</span>
                    <span className="hand inline-flex items-center gap-1.5 text-[0.84rem] text-teal-deep tabular-nums">
                      <IconClock className="text-sm" /> {fmtHours(l.hours)}
                      {l.hoursApproved !== null && " approved"}
                    </span>
                    {l.lastFetchError && (
                      <span className="hand basis-full text-[0.78rem] text-coral-deep">
                        last sync failed, showing the last total we had
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => unlink(l.id)}
                      disabled={busy !== null || l.hoursApproved !== null}
                      title={
                        l.hoursApproved !== null ? "A reviewer has set hours on this link, so it stays" : undefined
                      }
                      aria-label={`Unlink ${l.hackatimeProject}`}
                    >
                      <IconX className="text-sm" /> {busy === l.id ? "Unlinking…" : "Unlink"}
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            {account.state === "unlinked" ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button
                  variant="teal"
                  disabled={busy !== null}
                  onClick={() =>
                    run("account", async () => {
                      await linkHackatime(`/projects/${projectId}`)
                    })
                  }
                >
                  {busy === "account" ? "Redirecting…" : "Connect Hackatime"}
                </Button>
                <span className="hand text-[0.84rem] text-navy-soft">optional, and only matters for code hours.</span>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <label htmlFor={`hackatime-${projectId}`} className="sr-only">
                  Hackatime project
                </label>
                <select
                  id={`hackatime-${projectId}`}
                  value={picked}
                  onChange={(e) => setPicked(e.target.value)}
                  disabled={available.length === 0 || busy !== null}
                  className={cx(inputClass, "min-w-0 flex-1 py-2.5 disabled:text-navy-soft")}
                >
                  <option value="">
                    {available.length === 0 ? "No other Hackatime projects yet" : "Pick a Hackatime project…"}
                  </option>
                  {available.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} · {fmtHours(p.totalSeconds / 3600)}
                    </option>
                  ))}
                </select>
                <Button variant="outline" onClick={link} disabled={!picked || busy !== null}>
                  <IconPlus className="text-sm" /> {busy === "link" ? "Linking…" : "Link project"}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>
    </>
  )
}
