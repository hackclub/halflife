"use client";

import { useEffect, useMemo, useState } from "react";
import { WeekScene } from "@/components/platform/art";
import { IconArrowRight, IconCheck, IconClock, IconFilm, IconLock, IconSparkle } from "@/components/platform/icons";
import { Button, Chip, Field, OptionRow, Panel, cx, inputClass } from "@/components/platform/ui";
import { STARTER_IDEAS, TIERS, WEEK_META } from "@/lib/curriculum";
import { submitFloorFor } from "@/lib/config/printers";
import { fmtHours } from "@/lib/projects";
import { recommendedTier, useStore } from "@/lib/store";
import type { Experience } from "@/lib/types";
import { Modal, ModalTitle } from "./Modal";
import { RepoInput, repoIsValid } from "@/components/platform/RepoField";
import { normalizeRepo } from "@/lib/repo";

const GOLD = "var(--color-gold-deep)";

const EXPERIENCE: { id: Experience; label: string; hint: string }[] = [
  { id: "first", label: "This is my first time!", hint: "Never touched a soldering iron. Perfect." },
  { id: "little", label: "Just a little…", hint: "A kit or two, maybe an Arduino blink." },
  { id: "some", label: "Yeah, I have built a good amount", hint: "You have shipped a project that works." },
  { id: "lots", label: "Hardware… is life…", hint: "You own more multimeters than mugs." },
];

const TOTAL = 6;

/**
 * The first checkpoint.
 *
 * It takes no checkpoint id any more: the node it stands for is derived from
 * whether onboarding is finished, not ticked off by this component, so there is
 * nothing here to name.
 */
export function FirstCheckpoint() {
  const {
    setOpenCheckpoint,
    experience,
    completeOnboarding,
    setPhase,
  } = useStore();

  // The first checkpoint only ever runs in week one, so this is the week it
  // introduces. Guarded rather than asserted because an empty curriculum would
  // otherwise surface as a blank modal instead of a loud failure.
  const week = WEEK_META[0];
  if (!week) throw new Error("The curriculum has no weeks in it");
  const [step, setStep] = useState(1);
  const [exp, setExp] = useState<Experience | null>(experience);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [repo, setRepo] = useState("");
  const [starter, setStarter] = useState<string | null>(null);
  const [pickedTier, setPickedTier] = useState<1 | 2 | 3 | null>(null);
  const [spin, setSpin] = useState(0);

  const beginner = exp === "first" || exp === "little";
  const suggested = recommendedTier(exp);
  const tierLocked = starter !== null;
  // A starter project is scoped to tier 1, so the choice is derived, not stored.
  const tier: 1 | 2 | 3 | null = tierLocked ? 1 : pickedTier;

  useEffect(() => {
    if (step !== 2) return;
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setSpin(n);
      if (n > 11) window.clearInterval(id);
    }, 120);
    return () => window.clearInterval(id);
  }, [step]);

  const canAdvance = useMemo(() => {
    if (step === 1) return exp !== null;
    if (step === 4) return name.trim().length > 1 && desc.trim().length > 4 && repoIsValid(repo);
    if (step === 5) return tier !== null;
    return true;
  }, [step, exp, name, desc, tier, repo]);

  function finish() {
    if (!exp) return;
    completeOnboarding({
      experience: exp,
      title: name.trim(),
      description: desc.trim(),
      starterProjectId: starter,
      // Null is legal only when a starter project has already locked the choice
      // to tier 1; the server rejects it from anyone who could still choose.
      requestedTier: tierLocked ? null : tier,
      // Only asked of someone past their first board; a beginner's is added
      // later from the project page, so nothing is sent for them here.
      githubRepo: exp === "first" ? null : normalizeRepo(repo).url,
    });
    setOpenCheckpoint(null);
    setPhase("tour");
  }

  const spinIndex = spin > 11 ? 0 : spin % WEEK_META.slice(0, 5).length;

  return (
    <Modal
      open
      onClose={() => setOpenCheckpoint(null)}
      accent={GOLD}
      size="lg"
      scrollKey={step}
      eyebrow={`Getting started: ${step}/${TOTAL}`}
      footer={
        <>
          <p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
            {step === 5 && tierLocked
              ? "Starter projects are locked to tier 1."
              : "Nothing here is final! You can change all of it later."}
          </p>
          <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>
            Back
          </Button>
          {step < TOTAL ? (
            <Button variant="gold" onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
              Next <IconArrowRight className="text-base" />
            </Button>
          ) : (
            <Button variant="gold" onClick={finish}>
              Let&apos;s go! <IconSparkle className="text-base" />
            </Button>
          )}
        </>
      }
    >
      {/* ---------------- 1 — experience ---------------- */}
      {step === 1 && (
        <div>
          <ModalTitle sub="This will have no effect on your experience, it is just for us — and it decides which funding tier we suggest later.">
            Have you built hardware before?
          </ModalTitle>
          <div className="grid gap-2.5">
            {EXPERIENCE.map((o) => (
              <OptionRow key={o.id} tone="gold" selected={exp === o.id} onClick={() => setExp(o.id)} hint={o.hint}>
                <span className="hand text-[0.98rem] font-semibold">{o.label}</span>
              </OptionRow>
            ))}
          </div>
        </div>
      )}

      {/* ---------------- 2 — the shape of the program ---------------- */}
      {step === 2 && (
        <div>
          <ModalTitle sub="Ten weeks. Five of them you design a project around that week's theme, five of them you build the thing you designed — same order, real parts.">
            Each week has a theme
          </ModalTitle>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
            {WEEK_META.slice(0, 5).map((w, i) => {
              const landed = spin > 11;
              const lit = landed ? i === 0 : i === spinIndex;
              return (
                <div
                  key={w.id}
                  className={cx(
                    "sketch relative overflow-hidden rounded-2xl px-3 py-3 text-center transition-all duration-200",
                    lit ? "scale-[1.04] bg-gold-pale" : "bg-white",
                  )}
                  style={
                    {
                      "--sk-color": lit ? GOLD : "var(--color-line)",
                      "--sk-radius": "16px",
                    } as React.CSSProperties
                  }
                >
                  <WeekScene theme={w.theme} className="mx-auto h-11 w-auto" />
                  <p className="hand mt-1.5 text-[0.74rem] leading-tight font-semibold text-navy">{w.theme}</p>
                  <p className="hand text-[0.64rem] text-navy-soft">Week {w.id}</p>
                </div>
              );
            })}
          </div>
          <p className="mt-5 text-[0.9rem] leading-relaxed text-navy-soft">
            Weeks 6 to 10 repeat those same five themes as build weeks. On week six the PCB you draw
            this week arrives as a real board, and you solder it.
          </p>
        </div>
      )}

      {/* ---------------- 3 — the week itself ---------------- */}
      {step === 3 && (
        <div>
          <p className="label text-sky-deep">{week.fullName}</p>
          <ModalTitle>{week.headline}</ModalTitle>
          <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
            <div>
              {beginner ? (
                <>
                  <Chip tone="sky">New to this? Read on</Chip>
                  <p className="mt-3 max-w-[64ch] text-[0.95rem] leading-relaxed text-navy">{week.primer}</p>
                  <p className="mt-3 max-w-[64ch] text-[0.9rem] leading-relaxed text-navy-soft">
                    You will not do this alone. The Docs tab has a walkthrough for your first board, and
                    every reel in the Doomscroller is someone else figuring out the same thing.
                  </p>
                </>
              ) : (
                <>
                  <Chip tone="sky">Some boards people are drawing this week</Chip>
                  <ul className="mt-3 grid gap-2">
                    {week.examples.map((e) => (
                      <li
                        key={e}
                        className="sketch rounded-xl bg-white px-4 py-2.5 text-[0.92rem] leading-snug text-navy"
                        style={{ "--sk-radius": "12px" } as React.CSSProperties}
                      >
                        {e}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="relative mx-auto w-full max-w-[280px] shrink-0 md:w-[260px]">
              <div className="overflow-hidden rounded-2xl bg-sky p-4">
                <WeekScene theme={week.theme} className="w-full" />
              </div>
              <span className="label absolute right-3 bottom-3 text-white/85">Week 1/10</span>
            </div>
          </div>
        </div>
      )}

      {/* ---------------- 4 — project creation ---------------- */}
      {step === 4 && (
        <div>
          <ModalTitle sub="You can always edit this later — the name especially.">
            Make your first project!
          </ModalTitle>
          <div className="grid gap-4">
            <Field label="Project name" hint="Give it a cool name." id="p-name">
              <input
                id="p-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setStarter(null);
                }}
                placeholder="Hackpad"
                className={inputClass}
              />
            </Field>
            <Field label="Project description" hint="Tell us what it does and who it is for." id="p-desc">
              <textarea
                id="p-desc"
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value);
                  setStarter(null);
                }}
                rows={3}
                placeholder="A three-key macropad with hot-swap sockets, so I can paste things without moving my hand."
                className={cx(inputClass, "resize-none")}
              />
            </Field>
            {/* Not asked of someone on their first ever board: a repo is one
                more unfamiliar thing on a screen that should only be asking
                what they want to make. It is on the project page when they
                get there. */}
            {exp !== "first" && <RepoInput id="p-repo" value={repo} onChange={setRepo} />}
          </div>

          <p className="mt-6 text-[0.95rem] font-bold text-navy">Or try one of these guided projects!</p>
          <p className="hand mt-0.5 text-[0.78rem] text-navy-soft">
            Guided projects are scoped to fit tier 1 funding, so picking one locks your tier.
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {STARTER_IDEAS.map((idea) => {
              const picked = starter === idea.id;
              return (
                <button
                  key={idea.id}
                  type="button"
                  onClick={() => {
                    setStarter(idea.id);
                    setName(idea.name);
                    setDesc(idea.blurb);
                  }}
                  aria-pressed={picked}
                  className={cx(
                    "sketch rounded-2xl px-4 py-3 text-left transition-colors",
                    picked ? "bg-gold-pale" : "bg-white hover:bg-gold-pale/50",
                  )}
                  style={
                    {
                      "--sk-color": picked ? GOLD : "var(--color-line)",
                      "--sk-radius": "16px",
                    } as React.CSSProperties
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[0.95rem] font-extrabold text-navy">{idea.name}</span>
                    {picked && <IconCheck className="text-base text-gold-deep" />}
                  </span>
                  <span className="mt-0.5 block text-[0.82rem] leading-snug text-navy-soft">{idea.blurb}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------- 5 — tiers ---------------- */}
      {step === 5 && (
        <div>
          <ModalTitle sub="Tiers decide how much funding you receive and roughly how many hours the project should take. You can change tier any time before you submit your projects!">
            Choose a tier
          </ModalTitle>
          {tierLocked && (
            <div
              className="sketch mb-4 flex items-start gap-3 rounded-2xl bg-gold-pale px-4 py-3"
              style={{ "--sk-color": GOLD, "--sk-radius": "16px" } as React.CSSProperties}
            >
              <IconLock className="mt-0.5 shrink-0 text-lg text-gold-deep" />
              <p className="text-[0.86rem] leading-snug text-navy">
                You picked a starter project, so this week is locked to tier 1. Pick your own idea on
                step 4 if you want a bigger budget.
              </p>
            </div>
          )}
          <div className="grid gap-2.5">
            {TIERS.map((t) => {
              const locked = tierLocked && t.id !== 1;
              const isSuggested = !tierLocked && t.id === suggested;
              return (
                <OptionRow
                  key={t.id}
                  tone="gold"
                  selected={tier === t.id}
                  disabled={locked}
                  onClick={() => setPickedTier(t.id)}
                  hint={
                    <>
                      {t.detail}
                      <span className="mt-1 block text-navy-soft/90">
                        {t.toBank} towards your 3D printer!
                      </span>
                    </>
                  }
                >
                  <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="text-[1rem] font-extrabold text-navy">Tier {t.id}</span>
                    <span className="hand text-[0.88rem] text-teal-deep">${t.grantUsd} funding</span>
                    <span className="hand text-[0.82rem] text-navy-soft">
                      · {fmtHours(submitFloorFor(t.fundingHours))} per design week
                    </span>
                    {isSuggested && <Chip tone="gold">Suggested for you</Chip>}
                    {locked && <Chip tone="muted">Locked</Chip>}
                  </span>
                </OptionRow>
              );
            })}
          </div>
        </div>
      )}

      {/* ---------------- 6 — journalling ---------------- */}
      {step === 6 && (
        <div>
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <ModalTitle sub="Every hour you log has to be backed by a journal entry or a timelapse.">
                Tracking your time
              </ModalTitle>
            </div>
            <button
              type="button"
              onClick={finish}
              className="hand shrink-0 text-[0.78rem] whitespace-nowrap text-navy-soft underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
            >
              I have journalled before — skip
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: IconFilm,
                title: "Timelapses",
                body: "Track time using Hack Club's Lapse! It'll record your chosen windows on your computer and track your time for you. After each session, make the session unlisted (or public!) and select it when making an entry to your project.",
              },
              {
                icon: IconClock,
                title: "Journal",
                body: "A session is one unbroken block. Reviewers can tell when four logged hours produced eleven minutes of footage.",
              },
              {
                icon: IconSparkle,
                title: "Write 200 characters",
                body: "What you did, what broke, what is next. Write it for yourself three weeks from now.",
              },
            ].map((c) => (
              <Panel key={c.title} tone="line" radius={18} className="bg-white px-4 py-4">
                <c.icon className="text-[1.5rem] text-gold-deep" />
                <p className="mt-2 text-[0.95rem] leading-tight font-extrabold text-navy">{c.title}</p>
                <p className="mt-1.5 text-[0.84rem] leading-snug text-navy-soft">{c.body}</p>
              </Panel>
            ))}
          </div>

          <div
            className="sketch mt-5 rounded-2xl bg-mint px-5 py-4"
            style={{ "--sk-color": "var(--color-teal)", "--sk-radius": "16px" } as React.CSSProperties}
          >
            <p className="text-[0.95rem] leading-snug font-bold text-teal-deep">
              That&apos;s it! Log hours, make some reels for other Hack Clubbers to see, and submit each week!
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}
