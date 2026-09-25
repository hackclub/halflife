"use client"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { Badge, Button, Callout, Field, Panel } from "@/app/components/ui"

interface ApiError {
  error?: { message?: string }
}

export interface OnboardingView {
  reached: number
  stepCount: number
  completed: boolean
  experience: string | null
  suggestedTier: number
  beginner: boolean
  steps: readonly { id: string; number: number; heading: string; skippable: boolean }[]
  experienceOptions: readonly { value: string; label: string }[]
  weekIntro: {
    kicker: string
    headline: string
    primer: string
    examples: readonly string[]
  } | null
  project: {
    title: string
    description: string
    requestedTier: number | null
    starterProjectId: string | null
    tierLocked: boolean
  }
  starterProjects: readonly { id: string; title: string; description: string }[]
  tiers: readonly {
    id: number
    name: string
    grantUsd: number
    fundingHours: number
    /** Funded hours plus the banking the cheapest machine needs. */
    submitFloorHours: number
    blurb: string
  }[]
}

/**
 * The first checkpoint.
 *
 * Interaction only: every value on screen came from the server, so each answer
 * POSTs and then `router.refresh()` re-renders from the source of truth rather
 * than from local state. `viewing` is the only thing this component owns, and
 * it is which step is on screen — never how far the participant has got, which
 * is the server's to say.
 */
export function OnboardingFlow({ initial }: Readonly<{ initial: OnboardingView }>) {
  const router = useRouter()
  const [viewing, setViewing] = useState(Math.min(initial.reached, initial.steps.length - 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [title, setTitle] = useState(initial.project.title)
  const [description, setDescription] = useState(initial.project.description)

  const step = initial.steps[viewing]
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
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as ApiError
        setError(payload.error?.message ?? `Something went wrong (${res.status})`)
        return
      }
      if (opts.advance !== false) {
        setViewing((v) => Math.min(v + 1, initial.steps.length - 1))
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title={`GETTING STARTED: ${step.number}/${initial.stepCount}`}
      actions={
        viewing > 0 ? (
          <Button onClick={() => setViewing((v) => Math.max(0, v - 1))} disabled={busy}>
            Back
          </Button>
        ) : null
      }
    >
      <div className="hl-stack hl-stack--tight">
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{step.heading}</h2>
        {error ? <Callout tone="danger">{error}</Callout> : null}

        {step.id === "experience" ? (
          <div className="hl-stack hl-stack--tight">
            {initial.experienceOptions.map((option) => (
              <Button
                key={option.value}
                variant={initial.experience === option.value ? "primary" : "default"}
                disabled={busy}
                onClick={() => send({ step: "experience", experience: option.value })}
              >
                {option.label}
              </Button>
            ))}
            <p className="hl-hint">this will have no effect on your experience, it&rsquo;s just for us! :)</p>
          </div>
        ) : null}

        {step.id === "week" && initial.weekIntro ? (
          <div className="hl-stack hl-stack--tight">
            <p className="hl-muted" style={{ margin: 0 }}>
              {initial.weekIntro.kicker}
            </p>
            <h3 style={{ margin: 0 }}>{initial.weekIntro.headline}</h3>
            {initial.beginner ? (
              <p style={{ margin: 0 }}>{initial.weekIntro.primer}</p>
            ) : (
              <>
                <p style={{ margin: 0 }}>Some places to start, if you want one:</p>
                <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
                  {initial.weekIntro.examples.map((example) => (
                    <li key={example}>{example}</li>
                  ))}
                </ul>
              </>
            )}
            <div>
              <Button variant="primary" disabled={busy} onClick={() => send({ step: "week" })}>
                Got it
              </Button>
            </div>
          </div>
        ) : null}

        {step.id === "project" ? (
          <form
            className="hl-stack hl-stack--tight"
            onSubmit={(e) => {
              e.preventDefault()
              void send({ step: "project", title, description })
            }}
          >
            <p className="hl-hint">Tell us about your project! You can always edit this later.</p>
            <Field label="Project name" hint="Give it a cool name!">
              <input className="hl-input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Project description">
              <textarea
                className="hl-textarea"
                value={description}
                maxLength={5000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? "Saving…" : "Next"}
              </Button>
            </div>
          </form>
        ) : null}

        {step.id === "idea" ? (
          <div className="hl-stack hl-stack--tight">
            <p className="hl-hint">
              Taking one of these sets your project to Tier 1, since they are all scoped to be Tier 1 work. Write your
              own idea instead if you want a bigger tier.
            </p>
            {initial.starterProjects.map((starter) => (
              <Panel
                key={starter.id}
                title={starter.title}
                actions={initial.project.starterProjectId === starter.id ? <Badge tone="success">Chosen</Badge> : null}
              >
                <p style={{ marginTop: 0 }}>{starter.description}</p>
                <Button disabled={busy} onClick={() => send({ step: "idea", starterProjectId: starter.id })}>
                  Build this one
                </Button>
              </Panel>
            ))}
            <div>
              <Button variant="primary" disabled={busy} onClick={() => send({ step: "idea", starterProjectId: null })}>
                I&rsquo;ll stick with my own idea
              </Button>
            </div>
          </div>
        ) : null}

        {step.id === "tier" ? (
          <div className="hl-stack hl-stack--tight">
            <p className="hl-hint">
              This is what we will fund your parts with. You can change it any time before you submit your design, and
              your reviewer decides the final tier when they approve it.
            </p>
            {initial.project.tierLocked ? (
              <Callout>
                You picked a starter project, so this one is Tier 1. Go back and write your own idea if you want to
                choose.
              </Callout>
            ) : null}
            {initial.tiers.map((tier) => {
              const chosen = initial.project.requestedTier === tier.id
              return (
                <Panel
                  key={tier.id}
                  title={`${tier.name} — $${tier.grantUsd}`}
                  actions={
                    chosen ? (
                      <Badge tone="success">Chosen</Badge>
                    ) : tier.id === initial.suggestedTier ? (
                      <Badge>Suggested for you</Badge>
                    ) : null
                  }
                >
                  <p style={{ marginTop: 0 }}>{tier.blurb}</p>
                  <p className="hl-hint">
                    {tier.fundingHours}h of work funds the parts. Everything above that banks toward your printer, so a
                    week is {tier.submitFloorHours}h before you can hand it in.
                  </p>
                  <Button
                    variant={chosen ? "primary" : "default"}
                    disabled={busy || initial.project.tierLocked}
                    onClick={() => send({ step: "tier", requestedTier: tier.id })}
                  >
                    {chosen ? "Chosen" : `Choose ${tier.name}`}
                  </Button>
                </Panel>
              )
            })}
            {initial.project.tierLocked ? (
              <div>
                <Button variant="primary" disabled={busy} onClick={() => send({ step: "tier", requestedTier: null })}>
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step.id === "tracking" ? (
          <div className="hl-stack hl-stack--tight">
            <p style={{ margin: 0 }}>
              Your hours are what get your project funded, and you log them two ways. A <strong>journal</strong> entry
              says what you did in a session. A <strong>timelapse</strong> is the video of you doing it — it is evidence
              for your reviewer, not extra hours, so it never counts twice.
            </p>
            <p className="hl-hint">
              Log both from your project page as you go. Logging on the day is worth doing: your streak counts days you
              journalled.
            </p>
            <div className="hl-row">
              <Button variant="primary" disabled={busy} onClick={() => send({ step: "tracking", dismissed: false })}>
                Finish
              </Button>
              <Button disabled={busy} onClick={() => send({ step: "tracking", dismissed: true })}>
                I&rsquo;ve journalled before, skip this
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}
