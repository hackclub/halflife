"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { WeekPainting } from "@/components/platform/art"
import { IconArrowRight } from "@/components/platform/icons"
import { RepoInput, repoIsValid } from "@/components/platform/RepoField"
import { Button, cx, Field, inputClass, OptionRow } from "@/components/platform/ui"
import { submitFloorFor } from "@/lib/config/printers"
import { WARMUP_THEME } from "@/lib/config/program"
import { BUILD_HOURS, TIERS } from "@/lib/curriculum"
import { normalizeRepo } from "@/lib/repo"
import { Modal, ModalTitle } from "./Modal"

function fmtH(h: number) {
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

/**
 * Start a warm-up project: the season's "create a project" sheet, for any
 * hardware idea rather than a theme, plus the one question a warm-up adds —
 * whether it is handed in as a design or as a finished build. It is handed in
 * once, as that.
 */
export function WarmupModal({ onClose, closesOn }: { onClose: () => void; closesOn: string | null }) {
  const router = useRouter()
  const [name, setName] = useState("")
  const [desc, setDesc] = useState("")
  const [repo, setRepo] = useState("")
  const [phase, setPhase] = useState<"DESIGN" | "BUILD" | null>(null)
  const [tier, setTier] = useState<1 | 2 | 3>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ok = name.trim().length > 1 && desc.trim().length > 4 && repoIsValid(repo) && phase !== null

  async function create() {
    if (!ok || !phase) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/projects/warmup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: name.trim(),
          description: desc.trim(),
          githubRepo: normalizeRepo(repo).url,
          requestedTier: tier,
          phase,
        }),
      })
      const payload = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null
      if (!res.ok || !payload?.id) {
        setError(payload?.error?.message ?? `The project was not created (${res.status}). Try again.`)
        return
      }
      router.push(`/projects/${payload.id}`)
      router.refresh()
      onClose()
    } catch {
      setError("Could not reach the server. Nothing was created — try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      accent="var(--color-violet)"
      size="lg"
      eyebrow="Warm-up project"
      footer={
        <>
          {error ? (
            <p role="alert" className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep">
              {error}
            </p>
          ) : (
            <p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
              Tier can be changed any time before you submit.
            </p>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="solid" disabled={!ok || saving} onClick={() => void create()}>
            {saving ? "Creating…" : "Create project"} <IconArrowRight className="text-base" />
          </Button>
        </>
      }
    >
      <ModalTitle
        sub={
          closesOn
            ? `Any hardware project you like, no theme. Journal it and submit it like every Half Life project. Warm-ups close ${closesOn}.`
            : "Any hardware project you like, no theme. Journal it and submit it like every Half Life project."
        }
      >
        Start a warm-up project
      </ModalTitle>

      <div className="grid gap-6 lg:grid-cols-[1fr_230px] lg:items-start">
        <div className="grid gap-4">
          <Field label="Project name" hint="Give it a cool name." id="wu-name">
            <input
              id="wu-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My warm-up project"
              maxLength={120}
              className={inputClass}
            />
          </Field>
          <Field label="Project description" hint="What it does, and what makes it yours." id="wu-desc">
            <textarea
              id="wu-desc"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              maxLength={4000}
              placeholder="A macropad with a rotary encoder for my editing shortcuts"
              className={cx(inputClass, "resize-none")}
            />
          </Field>
          <RepoInput id="wu-repo" value={repo} onChange={setRepo} />

          <fieldset className="mt-2 grid gap-2.5">
            <legend className="label mb-2 text-violet-deep">What will you submit?</legend>
            <OptionRow
              selected={phase === "DESIGN"}
              onClick={() => setPhase("DESIGN")}
              hint="Design it and submit it with a parts list to get it funded."
            >
              <span className="text-[0.98rem] font-extrabold text-navy">A design</span>
            </OptionRow>
            <OptionRow
              selected={phase === "BUILD"}
              onClick={() => setPhase("BUILD")}
              hint="You already have the parts. Build it and submit a demo of it working."
            >
              <span className="text-[0.98rem] font-extrabold text-navy">A finished build</span>
            </OptionRow>
          </fieldset>

          <fieldset className="mt-2 grid gap-2.5">
            <legend className="label mb-2 text-violet-deep">Funding tier</legend>
            {TIERS.map((t) => (
              <OptionRow
                key={t.id}
                selected={tier === t.id}
                onClick={() => setTier(t.id)}
                hint={
                  <>
                    {t.detail}
                    {phase !== "BUILD" && (
                      <span className="mt-1 block text-navy-soft/90">
                        You can submit on tier {t.id} from {fmtH(submitFloorFor(t.fundingHours))} of design time.
                      </span>
                    )}
                  </>
                }
              >
                <span className="flex flex-wrap items-baseline gap-x-2.5">
                  <span className="text-[0.98rem] font-extrabold text-navy">Tier {t.id}</span>
                  <span className="hand text-[0.86rem] text-teal-ink">${t.grantUsd} for parts</span>
                  <span className="hand text-[0.8rem] text-navy-soft">
                    · {fmtH(phase === "BUILD" ? BUILD_HOURS : submitFloorFor(t.fundingHours))} to submit
                  </span>
                </span>
              </OptionRow>
            ))}
          </fieldset>
        </div>

        <div className="order-first lg:order-none">
          <div className="overflow-hidden rounded-2xl bg-violet-pale p-4">
            <WeekPainting
              theme={WARMUP_THEME.label}
              alt=""
              sizes="(min-width: 1024px) 198px, 220px"
              className="mx-auto aspect-square w-full max-w-[220px]"
            />
          </div>
          <p className="mt-3 text-[0.86rem] leading-snug text-navy-soft">
            Each warm-up is one submission: a design or a finished build, whichever you choose here. You can start as
            many as you like.
          </p>
        </div>
      </div>
    </Modal>
  )
}
