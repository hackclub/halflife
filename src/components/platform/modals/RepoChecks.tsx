"use client"

import { useCallback, useEffect, useState } from "react"
import { IconCheck, IconWarning } from "@/components/platform/icons"
import { RepoEditor } from "@/components/platform/RepoField"
import { Button, cx } from "@/components/platform/ui"
import type { RepoCheck, RepoCheckResult } from "@/lib/repo-checks"
import type { Project } from "@/lib/types"

/**
 * What the repo has, checked against what this week needs — before the maker
 * hands it in rather than after a reviewer bounces it.
 *
 * Failures that block are coral and say how to fix them; recommendations are
 * amber and never block; GitHub being unreachable is amber too, because that
 * is ours to absorb. The repo being checked sits under the heading with its
 * editor, so a wrong or missing link is fixed without leaving the sheet, and
 * a new link re-runs the checks. Otherwise the fix is a push, and "Check
 * again" is how the sheet finds out.
 */
export function RepoChecks({
  project,
  onResult,
  editable = true,
}: {
  project: Project
  onResult: (result: RepoCheckResult | null) => void
  /**
   * Whether the link can be changed from here. The submit sheet says yes, so a
   * wrong link is fixed without leaving it; the project page says no, because
   * its own details editor already owns the link.
   */
  editable?: boolean
}) {
  const [data, setData] = useState<RepoCheckResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setLoading(true)
    setError(null)
    onResult(null)
    try {
      const res = await fetch(`/api/projects/${project.id}/preflight`, { cache: "no-store" })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error?.message ?? "Could not check the repo")
      setData(body as RepoCheckResult)
      onResult(body as RepoCheckResult)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
    // The link is the input: a new one means a fresh check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.githubRepo])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching on mount and on a new link
    void run()
  }, [run])

  const blocking = data?.checks.filter((c) => c.blocking && c.status === "fail").length ?? 0

  return (
    <section
      aria-labelledby="repo-checks-title"
      className="sketch mb-5 rounded-2xl bg-white px-4 py-4 sm:px-5"
      style={{ "--sk-radius": "16px" } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="repo-checks-title" className="label text-violet-deep">
          Repo checks
        </h3>
        <Button variant="ghost" size="sm" onClick={() => void run()} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </Button>
      </div>
      {/* Where the link can be changed, it sits here with its editor. Where it
          cannot — the project page — it is already in the page's heading, and
          saying it twice a few lines apart only makes the reader compare them. */}
      {editable && <RepoEditor project={project} className="mt-1" />}

      {loading && !data ? (
        <p className="hand mt-2 text-[0.84rem] text-navy-soft" aria-live="polite">
          reading your repo on GitHub…
        </p>
      ) : error ? (
        <p role="alert" className="mt-2 text-[0.85rem] font-semibold text-coral-deep">
          {error}
        </p>
      ) : data ? (
        <>
          <p className="mt-1 text-[0.9rem] leading-snug text-navy-soft" aria-live="polite">
            {blocking > 0
              ? `${blocking} ${blocking === 1 ? "thing needs" : "things need"} fixing before you can hand this in.`
              : data.unavailable
                ? "GitHub could not be reached, so this was not checked. You can still hand it in."
                : "Everything this week needs is in the repo."}
          </p>
          <ul className={cx("mt-3 grid gap-1.5", loading && "opacity-60")}>
            {data.checks.map((c) => (
              <CheckRow key={c.key} check={c} />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}

function CheckRow({ check }: { check: RepoCheck }) {
  const tone =
    check.status === "pass" ? "text-teal-deep" : check.status === "fail" ? "text-coral-deep" : "text-orange-deep"
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={cx(
          "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
          check.status === "pass" ? "bg-mint" : check.status === "fail" ? "bg-coral/15" : "bg-gold-pale",
          tone,
        )}
        aria-hidden="true"
      >
        {check.status === "pass" ? (
          <IconCheck className="text-[0.7rem]" strokeWidth={3.4} />
        ) : (
          <IconWarning className="text-[0.75rem]" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cx("block text-[0.9rem] font-bold", check.status === "pass" ? "text-navy" : tone)}>
          {check.label}
          <span className="sr-only">
            {check.status === "pass" ? " (passed)" : check.blocking ? " (required)" : " (recommended)"}
          </span>
        </span>
        {check.detail && (
          <span className="block text-[0.8rem] leading-snug [overflow-wrap:anywhere] text-navy-soft">
            {check.detail}
          </span>
        )}
      </span>
    </li>
  )
}
