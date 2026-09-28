"use client"

import { type ReactNode, useState } from "react"
import { Gato, WeekPainting } from "@/components/platform/art"
import { IconCheck } from "@/components/platform/icons"
import { ProjectChoiceCard, StarterProjectCard } from "@/components/platform/StarterProjectCard"
import { Button, Chip, Field, OptionRow, Panel } from "@/components/platform/ui"
import type { OnboardingView } from "@/lib/onboarding-view"

const projectInputClass =
  "block w-full rounded-xl border-2 border-field bg-black/[.02] px-4 py-2.5 text-[0.9rem] text-navy outline-none transition-colors placeholder:text-navy-faint hover:border-navy-soft focus:border-violet focus:bg-white"

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
  const [view, setView] = useState(initial)
  const [viewing, setViewing] = useState(Math.min(initial.reached, initial.steps.length - 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState(initial.project.title)
  const [description, setDescription] = useState(initial.project.description)

  const step = view.steps[viewing]
  if (!step) return null

  // The server decides where an answer lands (a starter taken on the week step
  // goes straight to time tracking; naming a project skips "Stuck? Pick one",
  // since the starter was offered on the week step), and this mirrors it, both
  // forward and back.
  const indexOf = (id: string) => view.steps.findIndex((s) => s.id === id)
  const tookStarter = view.project.starterProjectId !== null && view.project.tierLocked
  function backFrom(current: number): number {
    const id = view.steps[current]?.id
    if (id === "tracking" && tookStarter) return indexOf("week")
    if (id === "tier") return indexOf("project")
    return Math.max(0, current - 1)
  }

  async function send(body: unknown, opts: { advance?: boolean } = {}): Promise<OnboardingView | null> {
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
        return null
      }

      const next = payload.onboarding
      setView(next)
      setTitle(next.project.title)
      setDescription(next.project.description)
      if (next.completed) {
        onComplete?.()
        return next
      }

      if (opts.advance !== false) {
        setViewing((current) => Math.min(current + 1, next.steps.length - 1))
      }
      return next
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
      return null
    } finally {
      setBusy(false)
    }
  }

  async function sendProject() {
    const next = await send({ step: "project", title, description }, { advance: false })
    if (next && !next.completed) setViewing(indexOf("tier"))
  }

  /** The beginner's fork on the week step: a starter, or their own project. */
  async function chooseStart(starterProjectId: string | null) {
    const next = await send({ step: "week", starterProjectId }, { advance: false })
    if (next && !next.completed) setViewing(indexOf(starterProjectId ? "tracking" : "project"))
  }

  // No panel of its own: it is the whole body of the Getting started modal,
  // whose frame and eyebrow already say what this is. A second bordered card
  // inside it only boxed the same content twice.
  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="label text-gold-ink">
            Step {step.number}/{view.stepCount}
          </p>
          {step.id === "week" && view.weekIntro ? (
            // The week step is a reveal: its heading trails off ("this week
            // it's...") so it leads in, and the theme it leads to is the title.
            <>
              <p className="hand mt-1.5 text-[0.95rem] text-navy-soft">{step.heading}</p>
              <h2 className="mt-0.5 text-[1.7rem] leading-tight font-extrabold tracking-[-0.025em] text-navy sm:text-[2.1rem]">
                {view.weekIntro.kicker}
              </h2>
            </>
          ) : (
            <h2 className="mt-1 text-[1.5rem] leading-tight font-extrabold tracking-[-0.02em] text-navy sm:text-[1.85rem]">
              {step.heading}
            </h2>
          )}
        </div>
        {viewing > 0 ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setViewing(backFrom)}
            disabled={busy}
          >
            Back
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mb-5 rounded-xl bg-coral/10 px-4 py-3 text-[0.86rem] font-semibold text-coral-dark">
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
                hint={option.hint}
                onClick={() => void send({ step: "experience", experience: option.value })}
              >
                <span className="text-[0.95rem] font-extrabold text-navy">{option.label}</span>
              </OptionRow>
            ))}
          </div>
        ) : null}

        {step.id === "week" && view.weekIntro ? (
          <div className="space-y-6">
            {/* What the week is: its painting, then the words. */}
            <div className="flex items-start gap-4 sm:gap-6">
              <WeekPainting
                theme={view.weekIntro.painting}
                alt=""
                sizes="(min-width: 640px) 120px, 84px"
                className="sticker-shadow size-[84px] shrink-0 sm:size-[120px]"
              />
              <div className="min-w-0 flex-1 space-y-2">
                {view.beginner ? (
                  <p className="max-w-[62ch] text-[0.92rem] leading-relaxed text-navy-soft">{view.weekIntro.primer}</p>
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
              </div>
            </div>

            {view.beginner && view.starterProjects.length > 0 ? (
              // The fork. Two ways in, side by side and the same shape, each
              // with its own button, so the choice reads as a choice.
              <div className="space-y-3 border-t border-dashed border-line/80 pt-5">
                <p className="text-[0.92rem] leading-relaxed text-navy-soft">
                  <strong className="font-extrabold text-navy">New to this?</strong> Build this week&rsquo;s starter
                  project, with a guide that walks you through every step. Or make a project of your own.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {view.starterProjects.map((starter) => {
                    const chosen = view.project.starterProjectId === starter.id
                    return (
                      <StarterProjectCard
                        key={starter.id}
                        starter={starter}
                        chosen={chosen}
                        stacked
                        action={
                          <Button variant="gold" disabled={busy} onClick={() => void chooseStart(starter.id)}>
                            Build {starter.title}
                            {chosen ? <IconCheck className="text-base" /> : null}
                          </Button>
                        }
                      />
                    )
                  })}
                  <ProjectChoiceCard
                    stacked
                    tileClassName="bg-violet-pale"
                    art={<Gato pose="schematic" sizes="260px" className="h-[140px] w-auto" />}
                    label="Custom project"
                    title="Your own idea"
                    action={
                      <Button variant="outline" disabled={busy} onClick={() => void chooseStart(null)}>
                        Make a custom project
                      </Button>
                    }
                  >
                    <p className="mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft">
                      Design the board you want to exist. You name it next, then choose how much funding it needs.
                    </p>
                  </ProjectChoiceCard>
                </div>
              </div>
            ) : (
              <Button variant="gold" disabled={busy} onClick={() => void send({ step: "week" })}>
                Got it
              </Button>
            )}
          </div>
        ) : null}

        {step.id === "project" ? (
          <form
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              void sendProject()
            }}
          >
            <p className="text-[0.9rem] leading-relaxed text-navy-soft">
              Tell us about your project! You can always edit this later.
            </p>
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
              Starter projects come with a guide that walks you through every step. Taking one sets your project to Tier
              1, since starters are Tier 1 work. Write your own idea instead if you want a bigger tier.
            </p>
            <div className="grid gap-3">
              {view.starterProjects.map((starter) => {
                const chosen = view.project.starterProjectId === starter.id
                return (
                  <StarterProjectCard
                    key={starter.id}
                    starter={starter}
                    chosen={chosen}
                    action={
                      <Button
                        variant={chosen ? "teal" : "outline"}
                        size="sm"
                        disabled={busy}
                        onClick={() => void send({ step: "idea", starterProjectId: starter.id })}
                      >
                        {chosen ? (
                          <>
                            Building {starter.title} <IconCheck className="text-base" />
                          </>
                        ) : (
                          `Build ${starter.title}`
                        )}
                      </Button>
                    }
                  />
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
              This is what we will fund your parts with. You can change it any time before you submit your design, and
              your reviewer decides the final tier when they approve it.
            </p>
            {view.project.tierLocked ? (
              <Note>
                You picked a starter project, so this one is Tier 1. You can go back and make a custom project if you'd like.
              </Note>
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
                        <p className="mt-1 text-[0.8rem] leading-relaxed text-navy-soft">{tier.detail}</p>
                        <p className="mt-1 text-[0.8rem] leading-relaxed text-navy-soft">
                          {tier.toBank} towards your 3D printer.
                        </p>
                      </div>
                      {chosen ? (
                        <Chip tone="teal">Chosen</Chip>
                      ) : tier.id === view.suggestedTier ? (
                        <Chip tone="gold">Suggested</Chip>
                      ) : null}
                    </div>
                    <p className="mt-3 text-[0.8rem] leading-relaxed text-navy-soft">
                      {tier.fundingHours}h of work funds the project. Everything above that banks toward your printer,
                      so a week is {tier.submitFloorHours}h before you can hand it in.
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
              Tracking progress of your project is mandatory, and you log it in two ways. A{" "}
              <strong className="text-navy">journal</strong> entry is a detailed writeup of what you did in a session. A{" "}
              <strong className="text-navy">timelapse</strong> is a screenrecording or video of yourself working on your project.
            </p>
            <ul className="grid gap-3 sm:grid-cols-3">
              {[
                ["Timelapses", "Use Lapse to record the work, then attach the recording to your project."],
                ["Journal", "Write what you did, what broke, and what is next after each session."],
                ["Keep it daily", "Logging on the day is worth doing: your streak counts days you journalled."],
              ].map(([heading, body]) => (
                <Panel key={heading} as="li" tone="line" radius={16} className="bg-white p-4">
                  <h3 className="text-[0.92rem] font-extrabold text-navy">{heading}</h3>
                  <p className="mt-2 text-[0.8rem] leading-relaxed text-navy-soft">{body}</p>
                </Panel>
              ))}
            </ul>
            <Button variant="gold" disabled={busy} onClick={() => void send({ step: "tracking", dismissed: false })}>
              Finish
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
