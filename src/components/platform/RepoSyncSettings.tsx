"use client"

import { useCallback, useEffect, useState } from "react"
import { IconCheck, IconWarning } from "@/components/platform/icons"
import { Button, Chip, cx } from "@/components/platform/ui"
import { linkForge } from "@/lib/auth-client"

/**
 * Repo sync — the control that mirrors a project's devlogs and parts list into
 * the maker's own repository, on whichever code forge they keep it on.
 *
 * Two states, one component: no forge linked, and linked. The choice of repo is
 * a picker rather than a text field because the sync has to push, and a repo
 * typed by hand is one the token may not be able to write to — which would fail
 * on every entry afterwards with a 403 nobody can act on from here. The picked
 * value is the repo's full URL, so the forge it belongs to travels with it.
 *
 * The first commit happens when the sync is switched on (the server does it
 * before the setting takes), so "on" always means "the files are in the repo",
 * never a promise that the next write will try.
 */

interface WritableRepo {
  fullName: string
  name: string
  ownerPath: string
  /** The repo's forge URL — what the sync stores and links out to. */
  url: string
  private: boolean
  defaultBranch: string
  pushedAt: string | null
}

interface SyncState {
  enabled: boolean
  repo: string | null
  forge: string | null
  syncedAt: number | null
  error: string | null
  linkedForges: string[]
  repos: WritableRepo[]
  reposError: string | null
}

/** The forges a maker can connect here, and how each is named in the UI. */
const FORGES = [
  { id: "github", label: "GitHub" },
  { id: "gitlab", label: "GitLab" },
] as const

function when(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  return new Date(ms).toLocaleDateString()
}

export function RepoSyncSettings({
  projectId,
  /**
   * Called after a successful enable/sync so a host page (the onboarding step,
   * say) can move on. The project page passes nothing.
   */
  onEnabled,
  /** Compact copy for the onboarding step, where there is less room. */
  compact = false,
}: {
  projectId: string
  onEnabled?: () => void
  compact?: boolean
}) {
  const [state, setState] = useState<SyncState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/repo-sync`, { cache: "no-store" })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not load the sync settings")
      setState(body as SyncState)
      // Pre-select the repo a project already points at, if it is one of the
      // writable ones, so re-enabling does not need the picker used again.
      const current = body.repo as string | null
      setPicked((p) => p ?? (body.repos as WritableRepo[]).find((r) => r.url === current)?.url ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the sync settings")
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount and on a new project
    void load()
  }, [load])

  async function send(method: "POST" | "PUT", body?: unknown) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/repo-sync`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        setError(payload?.error?.message ?? "That did not work. Try again.")
        return false
      }
      await load()
      return true
    } catch {
      setError("Could not reach the server. Try again.")
      return false
    } finally {
      setBusy(false)
    }
  }

  if (loading && !state) {
    return (
      <p className="hand text-[0.84rem] text-navy-soft" aria-live="polite">
        checking your repos…
      </p>
    )
  }
  if (!state) {
    return (
      <p role="alert" className="text-[0.85rem] font-semibold text-coral-deep">
        {error ?? "Could not load the sync settings"}
      </p>
    )
  }

  // No forge linked: the whole feature is gated on it, so the prompt is the
  // panel. A maker picks whichever service their project already lives on.
  if (state.linkedForges.length === 0) {
    return (
      <div className="grid gap-3">
        <p className="text-[0.9rem] leading-relaxed text-navy-soft">
          {compact
            ? "Connect a code forge to keep your devlogs and parts list in your project's repo."
            : "Connect the code forge your project lives on — GitHub or GitLab — to mirror this project's devlogs and parts list into its repository. Syncing needs permission to write to the repo you choose; nothing else on your account is touched."}
        </p>
        {error && (
          <p role="alert" className="text-[0.85rem] font-semibold text-coral-deep">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {FORGES.map((forge) => (
            <Button
              key={forge.id}
              variant="solid"
              onClick={() => void linkForge(forge.id, window.location.pathname + window.location.search)}
            >
              Connect {forge.label}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  if (state.enabled) {
    return (
      <div className="grid gap-3">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Chip tone="teal">
            <IconCheck className="text-sm" /> Syncing
          </Chip>
          <a
            href={state.repo ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.9rem] font-semibold text-navy underline decoration-line-strong decoration-dashed underline-offset-4 transition-colors hover:decoration-violet"
          >
            {state.repo ? state.repo.replace(/^https?:\/\//, "") : "the repo"}
          </a>
          {state.syncedAt && <span className="hand text-[0.82rem] text-navy-soft">synced {when(state.syncedAt)}</span>}
        </p>
        <p className="text-[0.85rem] leading-relaxed text-navy-soft">
          Your journal entries land in <code className="hand text-navy">JOURNAL.md</code> and your parts list in{" "}
          <code className="hand text-navy">BOM.md</code>, in the repo&apos;s default branch. Each new entry updates them
          automatically.
        </p>

        {state.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-coral/10 px-3.5 py-2.5 text-[0.85rem] font-semibold text-coral-deep"
          >
            <IconWarning className="mt-0.5 shrink-0" />
            <span>
              The last sync did not land: {state.error} Reconnect {state.forge === "gitlab" ? "GitLab" : "GitHub"} and
              try again.
            </span>
          </p>
        )}
        {error && (
          <p role="alert" className="text-[0.85rem] font-semibold text-coral-deep">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void send("PUT")}>
            {busy ? "Syncing…" : "Sync now"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send("POST", { enabled: false })}>
            Turn off
          </Button>
        </div>
      </div>
    )
  }

  // Linked, off: pick a repo and switch it on.
  return (
    <div className="grid gap-3">
      <p className="text-[0.9rem] leading-relaxed text-navy-soft">
        {compact
          ? "Keep your devlogs and parts list in your project's repo."
          : "Pick the repository to mirror this project into. Your journal entries become JOURNAL.md and your parts list becomes BOM.md, updated automatically as you log work."}
      </p>

      {state.reposError ? (
        <p role="alert" className="text-[0.85rem] font-semibold text-coral-deep">
          {state.reposError}
        </p>
      ) : state.repos.length === 0 ? (
        <p className="hand text-[0.86rem] text-navy-soft">
          no repositories you can push to were found. Make one on{" "}
          {state.linkedForges.length > 1
            ? "GitHub or GitLab"
            : state.linkedForges[0] === "gitlab"
              ? "GitLab"
              : "GitHub"}
          , then check again.
        </p>
      ) : (
        <label className="grid gap-1.5">
          <span className="label text-violet-deep">Repository</span>
          <select
            value={picked ?? ""}
            onChange={(e) => setPicked(e.target.value || null)}
            className="block w-full rounded-xl border-2 border-field bg-white px-3.5 py-2.5 text-[0.9rem] text-navy outline-none transition-colors hover:border-navy-soft focus:border-violet"
          >
            <option value="">Choose a repo…</option>
            {state.repos.map((r) => (
              <option key={r.url} value={r.url}>
                {r.fullName}
                {r.private ? " (private)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="text-[0.85rem] font-semibold text-coral-deep">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="solid"
          size="sm"
          disabled={busy || !picked}
          onClick={() => {
            void (async () => {
              if (await send("POST", { enabled: true, repo: picked })) onEnabled?.()
            })()
          }}
        >
          {busy ? "Writing to the repo…" : "Turn on syncing"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy || loading} onClick={() => void load()}>
          Check again
        </Button>
      </div>
      <p className={cx("hand text-[0.8rem] text-navy-soft", compact && "hidden")}>
        it writes JOURNAL.md and BOM.md to the repo&apos;s default branch, with one commit per update.
      </p>
    </div>
  )
}
