"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { Button, Chip, Field, OptionRow, Panel } from "@/components/platform/ui"
import type { OnboardingView } from "@/lib/onboarding-view"

const projectInputClass =
  "block w-full rounded-xl border-2 border-line bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-soft/70 hover:border-line-strong focus:border-violet focus:bg-white"

interface OnboardingResponse {
  onboarding?: OnboardingView
  error?: { message?: string }
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-gold-deep/40 bg-gold-pale/50 px-4 py-3 text-[0.86rem] leading-relaxed text-navy-soft">
      {children}
    </div>
  )
}

/**
 * The one onboarding interaction. It is rendered by the dashboard's Get
 * started modal; the server owns the state machine and every response returns
 * the next canonical view.
 */
export function OnboardingFlow({
  initial,
  onComplete,
}: Readonly<{ initial: OnboardingView; onComplete?: () => void }>) {
  const router = useRouter()
  const [view, setView] = useState(initial)
  const [viewing, setViewing] = useState(Math.min(initial.reached, initial.steps.length - 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(initial.project.title)
  const [description, setDescription] = useState(initial.project.description)

  const step = view.steps[viewing]
  if (!step) return null

  async function send(body: unknown, opts: { advance?: boolean } = {}) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const payload = (await res.json().catch(() => null)) as OnboardingResponse | null
      if (!res.ok || !payload?.onboarding) {
        setError(payload?.error?.message ?? `Something went wrong (${res.status})`)
        return
      }

      const next = payload.onboarding
      setView(next)
      setTitle(next.project.title)
      setDescription(next.project.description)
      if (next.completed) {
        onComplete?.()
        return
      }

      if (opts.advance !== false) {
        setViewing((current) => Math.min(current + 1, next.steps.length - 1))
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel tone="gold" radius={20} className="bg-paper p-5 sm:p-7">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="label text-gold-deep">GETTING STARTED: {step.number}/{view.stepCount}</p>
          <h2 className="mt-1 text-[1.45rem] font-extrabold tracking-[-0.02em] text-navy sm:text-[1.7rem]">
            {step.heading}
          </h2>
        </div>
        {viewing > 0 ? (
          <Button variant="outline" size="sm" onClick={() => setViewing((current) => Math.max(0, current - 1))} disabled={busy}>
            Back
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-5 rounded-xl bg-coral/10 px-4 py-3 text-[0.86rem] font-semibold text-coral-deep">
          {error}
        </p>
      ) : null}

      <div className="space-y-5">
        {step.id === "experience" ? (
          <div className="space-y-3">
            {view.experienceOptions.map((option) => (
              <OptionRow
                key={option.value}
                tone="gold"
                selected={view.experience === option.value}
                disabled={busy}
                onClick={() => void send({ step: "experience", experience: option.value })}
              >
                <span className="text-[0.95rem] font-extrabold text-navy">{option.label}</span>
              </OptionRow>
            ))}
            <p className="hand text-[0.8rem] text-navy-soft">This helps us suggest the right funding tier. It does not affect your experience.</p>
          </div>
        ) : null}

        {step.id === "week" && view.weekIntro ? (
          <div className="space-y-4">
            <p className="label text-sky-deep">{view.weekIntro.kicker}</p>
            <h3 className="text-[1.2rem] font-extrabold text-navy">{view.weekIntro.headline}</h3>
            {view.beginner ? (
              <p className="text-[0.92rem] leading-relaxed text-navy-soft">{view.weekIntro.primer}</p>
            ) : (
              <>
                <p className="text-[0.92rem] text-navy-soft">Some places to start, if you want one:</p>
                <ul className="list-disc space-y-1 pl-5 text-[0.9rem] text-navy-soft">
                  {view.weekIntro.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </>
            )}
            <Button variant="gold" disabled={busy} onClick={() => void send({ step: "week" })}>
              Got it
            </Button>
          </div>
        ) : null}

        {step.id === "project" ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void send({ step: "project", title, description })
            }}
          >
            <p className="text-[0.9rem] leading-relaxed text-navy-soft">Tell us about your project! You can always edit this later.</p>
            <Field id="onboarding-project-name" label="Project name" hint="Give it a cool name!">
              <input
                id="onboarding-project-name"
                className={projectInputClass}
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field id="onboarding-project-description" label="Project description">
              <textarea
                id="onboarding-project-description"
                className={`${projectInputClass} min-h-28 resize-y`}
                value={description}
                maxLength={5000}
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Button type="submit" variant="gold" disabled={busy}>
              {busy ? "Saving…" : "Next"}
            </Button>
          </form>
        ) : null}

        {step.id === "idea" ? (
          <div className="space-y-4">
            <p className="text-[0.9rem] leading-relaxed text-navy-soft">
              Taking one of these sets your project to Tier 1, since they are all scoped to Tier 1 work. Write your own idea instead if you want a bigger tier.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {view.starterProjects.map((starter) => {
                const chosen = view.project.starterProjectId === starter.id
                return (
                  <Panel key={starter.id} tone="line" radius={16} className="flex flex-col bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-[0.98rem] font-extrabold text-navy">{starter.title}</h3>
                      {chosen ? <Chip tone="teal">Chosen</Chip> : null}
                    </div>
                    <p className="mt-2 flex-1 text-[0.84rem] leading-relaxed text-navy-soft">{starter.description}</p>
                    <Button
                      className="mt-4 self-start"
                      variant={chosen ? "teal" : "outline"}
                      size="sm"
                      disabled={busy}
                      onClick={() => void send({ step: "idea", starterProjectId: starter.id })}
                    >
                      {chosen ? "Chosen" : "Build this one"}
                    </Button>
                  </Panel>
                )
              })}
            </div>
            <Button variant="gold" disabled={busy} onClick={() => void send({ step: "idea", starterProjectId: null })}>
              I&rsquo;ll stick with my own idea
            </Button>
          </div>
        ) : null}

        {step.id === "tier" ? (
          <div className="space-y-4">
            <p className="text-[0.9rem] leading-relaxed text-navy-soft">
              This is what we will fund your parts with. You can change it any time before you submit your design, and your reviewer decides the final tier when they approve it.
            </p>
            {view.project.tierLocked ? (
              <Note>You picked a starter project, so this one is Tier 1. Go back and write your own idea if you want to choose.</Note>
            ) : null}
            <div className="grid gap-3">
              {view.tiers.map((tier) => {
                const chosen = view.project.requestedTier === tier.id
                return (
                  <Panel key={tier.id} tone={chosen ? "gold" : "line"} radius={16} className="bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-[1rem] font-extrabold text-navy">
                          {tier.name} — ${tier.grantUsd}
                        </h3>
                        <p className="mt-1 text-[0.84rem] leading-relaxed text-navy-soft">{tier.blurb}</p>
                      </div>
                      {chosen ? <Chip tone="teal">Chosen</Chip> : tier.id === view.suggestedTier ? <Chip tone="gold">Suggested</Chip> : null}
                    </div>
                    <p className="mt-3 text-[0.8rem] leading-relaxed text-navy-soft">
                      {tier.fundingHours}h of work funds the project. Everything above that banks toward your printer, so a week is {tier.submitFloorHours}h before you can hand it in.
                    </p>
                    <Button
                      className="mt-4"
                      variant={chosen ? "gold" : "outline"}
                      size="sm"
                      disabled={busy || view.project.tierLocked}
                      onClick={() => void send({ step: "tier", requestedTier: tier.id })}
                    >
                      {chosen ? "Chosen" : `Choose ${tier.name}`}
                    </Button>
                  </Panel>
                )
              })}
            </div>
            {view.project.tierLocked ? (
              <Button variant="gold" disabled={busy} onClick={() => void send({ step: "tier", requestedTier: null })}>
                Next
              </Button>
            ) : null}
          </div>
        ) : null}

        {step.id === "tracking" ? (
          <div className="space-y-4">
            <p className="text-[0.92rem] leading-relaxed text-navy-soft">
              Your hours are what get your project funded, and you log them two ways. A <strong className="text-navy">journal</strong> entry says what you did in a session. A <strong className="text-navy">timelapse</strong> is evidence for your reviewer, not extra hours, so it never counts twice.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Timelapses", "Use Lapse to record the work, then attach the recording to your project."],
                ["Journal", "Write what you did, what broke, and what is next after each session."],
                ["Keep it daily", "Logging on the day is worth doing: your streak counts days you journalled."],
              ].map(([heading, body]) => (
                <Panel key={heading} tone="line" radius={16} className="bg-white p-4">
                  <h3 className="text-[0.92rem] font-extrabold text-navy">{heading}</h3>
                  <p className="mt-2 text-[0.8rem] leading-relaxed text-navy-soft">{body}</p>
                </Panel>
              ))}
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="gold" disabled={busy} onClick={() => void send({ step: "tracking", dismissed: false })}>
                Finish
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void send({ step: "tracking", dismissed: true })}>
                I&rsquo;ve journalled before, skip this
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
