"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FoxAvatar, FoxMark, PrinterArt, ReelScene, WeekScene } from "@/components/platform/art"
import {
  IconCheck,
  IconCoin,
  IconClock,
  IconFilm,
  IconLock,
  IconSparkle,
  IconUpload,
} from "@/components/platform/icons"
import { Button, cx } from "@/components/platform/ui"
import { BUILD_HOURS, WEEK_META, checkpointsFor } from "@/lib/curriculum"
import { MIN_HOURS_PER_WEEK } from "@/lib/config/printers"

/**
 * The fly-through plays before anyone has picked a tier, so it previews the
 * tier-1 shape. The bonus node is earned, not given, so it stays off.
 */
const WEEKS = WEEK_META.map((meta) => ({
  ...meta,
  checkpoints: checkpointsFor(meta, [], () => false, meta.phase === "build" ? BUILD_HOURS : MIN_HOURS_PER_WEEK),
}))
import { printerById, type PrinterGoal } from "@/lib/config/printers"
import { useStore } from "@/lib/store"

/**
 * The first thing anyone sees: a single unbroken fall down the trail.
 *
 * The claim Half Life makes is "ten weeks", so the intro spends its time
 * proving the distance rather than describing it — the camera drops through
 * every week banner in order, a counter on the right ticks 1 to 10, and it
 * decelerates onto the machine sitting at the bottom of the run. The diorama
 * is the real home page at the real proportions, so when the spotlight lands on
 * the yellow checkpoint a moment later the viewer is already oriented.
 */

/* ------------------------------------------------------------------ *
 * Stage layout — computed once, shared by the markup and the camera
 * ------------------------------------------------------------------ */
const STAGE_W = 1520
const COL_X = 760 // centre of the trail column
const TOP_PAD = 150
const BANNER_H = 96
const BANNER_GAP = 30
const PUCK = 66
const STEP = 88
const WEEK_GAP = 44
const AMP = 140
const PRIZE_H = 560
/** Where a week banner parks once its block reaches the top of the frame. */
const STICK = 18

const nodeX = (i: number) => COL_X + AMP * Math.sin(i * 1.02)

interface Block {
  top: number
  trailTop: number
  height: number
}

const BLOCKS: Block[] = []
{
  let y = TOP_PAD
  for (const w of WEEKS) {
    const trailH = (w.checkpoints.length - 1) * STEP + PUCK
    const height = BANNER_H + BANNER_GAP + trailH + WEEK_GAP
    BLOCKS.push({ top: y, trailTop: y + BANNER_H + BANNER_GAP, height })
    y += height
  }
}

// BLOCKS is built above, one entry per week, so it is never empty; the
// fallback keeps that a compile-time fact rather than an assertion.
const LAST = BLOCKS[BLOCKS.length - 1] ?? { top: 0, trailTop: 0, height: 0 }
const PRIZE_TOP = LAST.top + LAST.height + 40
const PRIZE_CENTRE = PRIZE_TOP + PRIZE_H / 2
const STAGE_H = PRIZE_TOP + PRIZE_H + 140

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */
const T = {
  titleHold: 1500,
  titleOut: 1100, // pull back to take in the whole platform
  dropIn: 900, // close on the trail column
  descent: 7200, // the fall, week 1 to the prize
  settle: 900,
}

const T_PLATFORM = T.titleHold
const T_TRAIL = T_PLATFORM + T.titleOut
const T_DESCENT = T_TRAIL + T.dropIn
const T_SETTLE = T_DESCENT + T.descent
const T_END = T_SETTLE + T.settle

const SCRIPT: { at: number; kicker: string; line: string | ((goal: string) => string) }[] = [
  {
    at: T_PLATFORM,
    kicker: "This is the whole thing",
    line: "Your trail, your feed, your shop — one page.",
  },
  {
    at: T_DESCENT - 250,
    kicker: "Week 1 · PCB",
    line: "Every week is a chain of checkpoints. Journal, film a reel, submit.",
  },
  {
    at: T_DESCENT + T.descent * 0.26,
    kicker: "Weeks 1 to 5 · Design",
    line: "A board, a 3D part, a synth, a display, a computer made of logic chips.",
  },
  {
    at: T_DESCENT + T.descent * 0.55,
    kicker: "Weeks 6 to 10 · Build",
    line: "Then the parts arrive and you build all five for real.",
  },
  {
    at: T_DESCENT + T.descent * 0.85,
    kicker: "Keep going",
    line: "Fifty-nine checkpoints. Ten weeks. One at a time.",
  },
  {
    at: T_SETTLE,
    kicker: "And at the bottom",
    line: (goal: string) => `A ${goal}, shipped to your door.`,
  },
]

const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)

/* ------------------------------------------------------------------ *
 * Stage
 * ------------------------------------------------------------------ */
function MiniPanel({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cx("rounded-2xl border-2 border-line bg-cream", className)}>{children}</div>
}

const KIND_ICON = {
  onboarding: IconSparkle,
  project: IconSparkle,
  journal: IconClock,
  reel: IconFilm,
  submit: IconUpload,
  demo: IconUpload,
  bonus: IconCoin,
} as const

function Stage({ goal }: { goal: PrinterGoal }) {
  return (
    <div className="relative" style={{ width: STAGE_W, height: STAGE_H }}>
      {/* ---- the shell, in frame while the camera is still at the top ---- */}
      <div className="absolute top-[40px] left-[40px] flex w-[300px] flex-col gap-5">
        <FoxMark className="w-[86px]" />
        <MiniPanel className="px-5 py-4">
          {["Home", "Projects", "Reels", "Explore", "Shop"].map((l, i) => (
            <p
              key={l}
              className={cx(
                "border-b border-dashed border-line py-2.5 text-[1.05rem] last:border-0",
                i === 0 ? "font-extrabold text-navy" : "font-semibold text-navy-soft",
              )}
            >
              {l}
            </p>
          ))}
        </MiniPanel>
        <MiniPanel className="relative overflow-hidden px-5 py-4">
          <PrinterArt kind={goal.kind} className="absolute -top-1 right-2 h-20 w-auto" />
          <p className="max-w-[60%] text-[0.95rem] leading-snug font-semibold text-navy">
            You are on track to get a <span className="text-teal-deep">{goal.name}</span>
          </p>
          <div className="mt-3 h-4 w-full overflow-hidden rounded-full bg-mint">
            <div className="h-full w-[12%] rounded-full bg-teal" />
          </div>
        </MiniPanel>
        <MiniPanel className="flex items-center gap-3 p-3">
          <FoxAvatar variant="fox-blueprint" className="size-[60px] rounded-lg" />
          <div>
            <p className="text-[1rem] font-extrabold text-navy">John Cena</p>
            <p className="hand text-[0.82rem] text-navy-soft">@johncena</p>
          </div>
        </MiniPanel>
      </div>

      <span className="absolute top-0 left-[380px] h-[880px] w-px border-l border-dashed border-line" />

      <div className="absolute top-[40px] left-[1180px] w-[300px]">
        <MiniPanel className="p-3.5">
          <p className="label mb-3 text-line-strong">The Doomscroller</p>
          <div className="flex flex-col gap-3">
            {(["hq", "pcb", "cad"] as const).map((s) => (
              <div key={s} className="relative overflow-hidden rounded-xl" style={{ aspectRatio: "9 / 13" }}>
                <ReelScene scene={s} className="absolute inset-0 size-full" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2.5 pt-8">
                  <p className="text-[0.72rem] font-bold text-white">
                    {s === "hq" ? "Half Life HQ" : s === "pcb" ? "Joe Bob" : "Froppii"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </MiniPanel>
      </div>

      {/* ---- the trail: every week, in order ---- */}
      {WEEKS.map((week, wi) => {
        const b = BLOCKS[wi]
        if (!b) return null
        return (
          <div key={week.id}>
            {week.checkpoints.map((cp, i) => {
              const done = wi === 0 && i === 0
              const live = wi === 0 && i <= 2
              const gate = cp.kind === "submit" || cp.kind === "demo"
              const Icon = done ? IconCheck : live ? KIND_ICON[cp.kind] : IconLock
              return (
                <div
                  key={cp.id}
                  className="absolute"
                  style={{ top: b.trailTop + i * STEP, left: nodeX(i) - PUCK / 2, width: PUCK }}
                >
                  <div
                    className={cx(
                      "puck",
                      done && "puck-done",
                      !done && !live && "puck-locked",
                      !done && live && gate && "puck-gate",
                    )}
                  >
                    <span className="puck-face">
                      <Icon className={cx("text-[1.35rem]", done || live ? "text-white" : "text-sand-deep")} />
                    </span>
                  </div>
                </div>
              )
            })}

            {week.checkpoints.slice(0, -1).map((_, i) =>
              [0.35, 0.65].map((f) => (
                <span
                  key={`${i}-${f}`}
                  className="absolute size-[6px] rounded-full bg-line-strong/45"
                  style={{
                    top: b.trailTop + (i + f) * STEP + PUCK / 2 - 3,
                    left: nodeX(i + f) - 3,
                  }}
                />
              )),
            )}
          </div>
        )
      })}

      {/* ---- the prize, at the bottom of the run ---- */}
      <div
        className="absolute flex flex-col items-center rounded-3xl border-[3px] border-gold-deep bg-gold-pale px-12 py-8"
        style={{ top: PRIZE_TOP, left: COL_X - 300, width: 600, height: PRIZE_H }}
      >
        <span className="label rounded-full bg-gold px-3 py-1.5 text-navy">Grand prize</span>
        <PrinterArt kind={goal.kind} className="mt-3 h-[280px] w-auto" />
        <p className="mt-3 text-[2rem] leading-none font-extrabold tracking-[-0.03em] text-navy">{goal.name}</p>
        <p className="hand mt-2 text-[1rem] text-navy-soft">finish all ten weeks</p>
      </div>
    </div>
  )
}

/**
 * The week banners are chrome, not scenery: like the real trail, each one
 * parks at the top of the frame while its week is passing and is then shoved
 * off by the next. They live in screen space so the camera loop can clamp them
 * every frame — CSS sticky needs a scroll container, and the stage is a
 * transform.
 */
function WeekBanners({ refs }: { refs: React.RefObject<(HTMLDivElement | null)[]> }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {WEEKS.map((week, i) => (
        <div
          key={week.id}
          ref={(el) => {
            refs.current[i] = el
          }}
          className="absolute top-0 left-1/2"
          style={{
            width: 760,
            height: BANNER_H,
            marginLeft: -380,
            transformOrigin: "center top",
            display: "none",
          }}
        >
          {/* The tear belongs to the plaque, never to the type. `.torn` is a
              displacement filter, so on a container it drags the glyphs about
              with the edges — and this one is re-scaled every frame by the
              camera, which rasterises the filtered result at one size and
              stretches it to another. The real trail's banner separates them
              the same way. */}
          <span aria-hidden="true" className="torn absolute inset-0 rounded" style={{ background: week.accent }} />
          <div className="relative flex h-full items-center gap-4 px-6">
            <div className="min-w-0 flex-1">
              <p className="label text-white/85">
                Week {week.id}/10 · {week.phase === "design" ? "Design" : "Build"}
              </p>
              <p className="mt-0.5 truncate text-[1.6rem] leading-none font-extrabold tracking-[-0.025em] text-white">
                {week.headline}
              </p>
            </div>
            <WeekScene theme={week.theme} className="h-14 w-auto shrink-0" />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Cinematic
 * ------------------------------------------------------------------ */
export function Cinematic() {
  const { setPhase, reducedMotion, goalId } = useStore()
  const goal = printerById(goalId)
  const camera = useRef<HTMLDivElement>(null)
  const banners = useRef<(HTMLDivElement | null)[]>([])
  const landing = useRef<(() => void) | null>(null)
  const skipped = useRef(false)
  const [ended, setEnded] = useState(reducedMotion)
  const [beat, setBeat] = useState(reducedMotion ? SCRIPT.length - 1 : -1)
  const [week, setWeek] = useState(reducedMotion ? WEEKS.length : 1)
  /** Depth, in whole percent, so the gauge re-renders ~100 times, not 800. */
  const [depth, setDepth] = useState(reducedMotion ? 100 : 0)
  /** Last painted camera position, so a skip can land from where it is. */
  const here = useRef({ fy: (BLOCKS[0]?.top ?? 0) + 250, scale: 0.6 })

  // The diorama is built once and kept out of every re-render the readouts
  // trigger, so the fall stays a pure transform on a stable layer.
  const stage = useMemo(() => <Stage goal={goal} />, [goal])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  useEffect(() => {
    const node = camera.current
    if (!node) return

    // Wide enough to take in rail, trail and feed at once.
    const platformScale = () => Math.min(window.innerWidth / 1620, window.innerHeight / 940)
    // Close enough that the trail column and one banner fill the frame.
    const trailScale = () => Math.min(window.innerWidth / 940, window.innerHeight / 620, 1.05)
    // The closing frame has to hold the whole prize card above the CTA.
    const CTA_ROOM = 190
    const prizeScale = () =>
      Math.min(Math.max(Math.min(window.innerWidth / 720, (window.innerHeight - CTA_ROOM) / 600), 0.3), 1)
    const prizeFocus = () => PRIZE_CENTRE + CTA_ROOM / 2 / prizeScale()

    const apply = (fy: number, scale: number) => {
      node.style.transform =
        `translate(-50%, -50%) scale(${scale.toFixed(4)}) ` +
        `translate(${STAGE_W / 2 - COL_X}px, ${STAGE_H / 2 - fy}px)`
    }

    /**
     * Sticky, by hand: a banner tracks its block until the block reaches the
     * top of the frame, holds there, then gets pushed up by the next one.
     */
    const pinBanners = (fy: number, scale: number) => {
      const vh = window.innerHeight
      const h = BANNER_H * scale
      // The counter reports the top-most banner still on screen, so the number
      // and the header a viewer is reading always name the same week.
      let pinned = -1
      for (let i = 0; i < BLOCKS.length; i += 1) {
        const el = banners.current[i]
        const natural = ((BLOCKS[i]?.top ?? 0) - fy) * scale + vh / 2
        const nextTop = BLOCKS[i + 1]?.top ?? PRIZE_TOP
        const nextNatural = (nextTop - fy) * scale + vh / 2
        const y = Math.min(Math.max(natural, STICK), nextNatural - h)
        if (pinned < 0 && y + h > 0) pinned = i
        if (!el) continue
        if (y + h < -24 || natural > vh + 48) {
          if (el.style.display !== "none") el.style.display = "none"
          continue
        }
        if (el.style.display === "none") el.style.display = ""
        el.style.transform = `translateY(${y.toFixed(1)}px) scale(${scale.toFixed(4)})`
      }
      return pinned < 0 ? WEEKS.length : pinned + 1
    }

    const startY = (BLOCKS[0]?.top ?? 0) + 250
    const endY = PRIZE_CENTRE

    if (reducedMotion) {
      apply(prizeFocus(), prizeScale())
      pinBanners(prizeFocus(), prizeScale())
      return
    }

    // A skip plays its own short landing so the camera and the banners stay in
    // step instead of the banners freezing mid-flight.
    landing.current = () => {
      const from = here.current
      const toFy = prizeFocus()
      const toScale = prizeScale()
      const t1 = performance.now()
      const land = (now: number) => {
        const k = easeOutExpo(clamp01((now - t1) / 700))
        const fy = lerp(from.fy, toFy, k)
        const sc = lerp(from.scale, toScale, k)
        apply(fy, sc)
        pinBanners(fy, sc)
        if (k < 1) window.requestAnimationFrame(land)
      }
      window.requestAnimationFrame(land)
    }

    let raf = 0
    const t0 = performance.now()

    const frame = (now: number) => {
      if (skipped.current) return
      const t = now - t0

      let fy: number
      let scale: number

      if (t < T_PLATFORM) {
        // Held close on the head of the trail while the title card sits over it.
        fy = startY
        scale = platformScale() * 1.55
      } else if (t < T_TRAIL) {
        const k = easeOutExpo(clamp01((t - T_PLATFORM) / T.titleOut))
        fy = lerp(startY, 460, k)
        scale = lerp(platformScale() * 1.55, platformScale(), k)
      } else if (t < T_DESCENT) {
        const k = easeInOutSine(clamp01((t - T_TRAIL) / T.dropIn))
        fy = lerp(460, startY, k)
        scale = lerp(platformScale(), trailScale(), k)
      } else if (t < T_SETTLE) {
        // The fall: one unbroken move, slow away and slow in. The camera also
        // pulls back where it is moving fastest, so two banners are in frame at
        // the speed where one would be a blur.
        const k = easeInOutSine(clamp01((t - T_DESCENT) / T.descent))
        fy = lerp(startY, endY - 90, k)
        scale = trailScale() * (1 - 0.2 * Math.sin(Math.PI * k))
      } else {
        const k = easeOutExpo(clamp01((t - T_SETTLE) / T.settle))
        fy = lerp(endY - 90, prizeFocus(), k)
        scale = lerp(trailScale(), prizeScale(), k)
      }

      apply(fy, scale)
      const pinned = pinBanners(fy, scale)
      here.current = { fy, scale }

      // Readouts come from where the camera actually is, not from the clock.
      const pct = Math.round(clamp01((fy - startY) / (endY - startY)) * 100)
      setDepth((d) => (d === pct ? d : pct))
      setWeek((w) => (w === pinned ? w : pinned))

      let idx = -1
      for (let i = 0; i < SCRIPT.length; i += 1) if (t >= (SCRIPT[i]?.at ?? 0)) idx = i
      setBeat((b) => (b === idx ? b : idx))

      if (t >= T_END) {
        setEnded(true)
        return
      }
      raf = window.requestAnimationFrame(frame)
    }

    raf = window.requestAnimationFrame(frame)
    return () => window.cancelAnimationFrame(raf)
  }, [reducedMotion])

  function skip() {
    skipped.current = true
    landing.current?.()
    setDepth(100)
    setWeek(WEEKS.length)
    setBeat(SCRIPT.length - 1)
    setEnded(true)
  }

  const title = beat < 0
  const line = beat >= 0 ? SCRIPT[beat] : null

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-cream">
      <div aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden">
        <div
          ref={camera}
          className="absolute top-1/2 left-1/2 will-change-transform"
          style={{ width: STAGE_W, height: STAGE_H }}
        >
          <div
            className="size-full transition-[opacity,filter] duration-700"
            style={{ opacity: title ? 0.2 : 1, filter: title ? "blur(7px)" : "none" }}
          >
            {stage}
          </div>
        </div>
      </div>

      <div
        className="pointer-events-none absolute inset-0 z-10 transition-[opacity,filter] duration-700"
        style={{ opacity: title ? 0.2 : 1, filter: title ? "blur(7px)" : "none" }}
      >
        <WeekBanners refs={banners} />
      </div>

      {/* title card */}
      {title && (
        <div className="absolute inset-0 z-20 grid place-items-center px-6 text-center">
          <div>
            <FoxMark className="mx-auto w-[clamp(96px,16vw,150px)] motion-safe:animate-[hl-pop_.7s_cubic-bezier(.16,1,.3,1)]" />
            <h1 className="mt-6 text-[clamp(3rem,13vw,7.5rem)] leading-[0.86] font-extrabold tracking-[-0.055em] text-navy motion-safe:animate-[hl-rise_.7s_.15s_cubic-bezier(.16,1,.3,1)_both]">
              HALF LIFE
            </h1>
            <p className="hand mt-4 text-[clamp(1rem,2.6vw,1.45rem)] text-navy-soft motion-safe:animate-[hl-rise_.7s_.32s_cubic-bezier(.16,1,.3,1)_both]">
              ten weeks of hardware, five designs, five builds
            </p>
          </div>
        </div>
      )}

      {/* depth gauge: how far down the trail the camera has fallen */}
      {!title && (
        <div
          aria-hidden="true"
          className="absolute top-1/2 right-3 z-20 flex -translate-y-1/2 flex-col items-center gap-2.5 rounded-full border border-line bg-cream/95 px-3 py-4 backdrop-blur-sm sm:right-7 sm:gap-3"
        >
          <span className="label text-navy-soft">Week</span>
          <span className="text-[1.5rem] leading-none font-extrabold text-navy tabular-nums sm:text-[2rem]">
            {week}
          </span>
          <div className="relative h-[clamp(110px,30vh,260px)] w-1.5 overflow-hidden rounded-full bg-line/60">
            <div
              className="absolute inset-x-0 top-0 rounded-full bg-navy"
              style={{ height: `${Math.max(3, depth)}%` }}
            />
          </div>
          <span className="label text-navy-soft">of 10</span>
        </div>
      )}

      {/* caption */}
      {line && !ended && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-20 sm:pb-12">
          <div
            key={beat}
            className="sketch sketch-2 max-w-[42rem] rounded-2xl bg-cream px-6 py-4 text-center lift-shadow motion-safe:animate-[hl-rise_.5s_cubic-bezier(.16,1,.3,1)_both]"
            style={{ "--sk-color": "var(--color-navy)", "--sk-radius": "18px" } as React.CSSProperties}
          >
            <p className="label text-coral">{line.kicker}</p>
            <p className="mt-1.5 text-[clamp(1.05rem,2.6vw,1.45rem)] leading-snug font-extrabold tracking-[-0.02em] text-navy">
              {typeof line.line === "function" ? line.line(goal.name) : line.line}
            </p>
          </div>
        </div>
      )}

      {/* end CTA */}
      {ended && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-8 sm:pb-10">
          <div
            className="sketch sketch-2 w-full max-w-md rounded-3xl bg-cream px-6 py-4 text-center lift-shadow motion-safe:animate-[hl-rise_.5s_cubic-bezier(.16,1,.3,1)_both]"
            style={{ "--sk-color": "var(--color-gold-deep)", "--sk-radius": "26px" } as React.CSSProperties}
          >
            <p className="label text-gold-deep">Ten weeks · fifty-nine checkpoints</p>
            <h2 className="mt-1.5 text-[clamp(1.2rem,3.2vw,1.6rem)] leading-tight font-extrabold tracking-[-0.03em] text-navy">
              That is what is waiting at the bottom
            </h2>
            <Button variant="gold" size="lg" full className="mt-4" onClick={() => setPhase("aim")}>
              Get started <IconSparkle className="text-base" />
            </Button>
          </div>
        </div>
      )}

      {!ended && (
        <button
          type="button"
          onClick={skip}
          className="label absolute top-5 right-5 z-30 rounded-full border-2 border-line bg-cream/80 px-4 py-2 text-navy-soft backdrop-blur-sm transition-colors hover:border-navy hover:text-navy"
        >
          Skip intro
        </button>
      )}
    </div>
  )
}
