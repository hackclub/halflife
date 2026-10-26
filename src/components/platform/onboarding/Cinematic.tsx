"use client"

import Image from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { Avatar } from "@/components/platform/Avatar"
import { Gato, PrinterPhoto, WeekPainting } from "@/components/platform/art"
import { IconCheck, IconClock, IconCoin, IconFilm, IconLock, IconPlay, IconUpload } from "@/components/platform/icons"
import { Button, onAccent } from "@/components/platform/ui"
import { MIN_HOURS_PER_WEEK, type PrinterGoal, printerById } from "@/lib/config/printers"
import { BUILD_HOURS, checkpointsFor, WEEK_META } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { useStore } from "@/lib/store"
import flightControllerShot from "../../../../public/projects/flightcontroller.png"
import hexapodShot from "../../../../public/projects/hexapod.png"
import macropadShot from "../../../../public/projects/macropad.png"

/** The mock Doomscroller's three reels, on photos of real projects makers built. */
const MOCK_REELS = [
	{ shot: macropadShot, who: "Half Life HQ" },
	{ shot: hexapodShot, who: "Joe Bob" },
	{ shot: flightControllerShot, who: "Froppii" },
]

/**
 * The fly-through plays before anyone has picked a tier, so it previews the tier-1 shape. The bonus node is earned, not given, so it stays off.
 */
const WEEKS = WEEK_META.map(meta =>
	Object.assign({}, meta, {
		checkpoints: checkpointsFor(meta, [], () => false, meta.phase === "build" ? BUILD_HOURS : MIN_HOURS_PER_WEEK),
	}),
)

/**
 * Always the Ender 3 V3 SE, never the picked goal, even if the default goal moves: it is the printer every finisher can reach, as on the trail's grand prize.
 */
const GOAL = printerById("ender-3-v3-se")

/**
 * The first thing anyone sees: one fall down the trail, in one direction.
 *
 * The claim Half Life makes is "ten weeks", so the intro spends its time proving the distance rather than describing it. The title sits at the head of the real home page; the camera lets go of it and drops through every week banner in order – gathering speed, never reversing – and lands on the machine at the bottom of the run. The diorama is the real home page at the real proportions, so when the spotlight finds the yellow checkpoint a moment later the viewer is already oriented.
 */

/* ------------------------------------------------------------------ *
 * Stage layout – computed once, shared by the markup and the camera
 * ------------------------------------------------------------------ */
const STAGE_W = 1520
const COL_X = 760 // centre of the trail column
/** Where the title is anchored: above week 1, between the rail and the feed. */
const TITLE_Y = 240
const TOP_PAD = 600
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
	height: number
	top: number
	trailTop: number
}

const BLOCKS: Block[] = []
{
	let y = TOP_PAD
	for (const w of WEEKS) {
		const trailH = (w.checkpoints.length - 1) * STEP + PUCK
		const height = BANNER_H + BANNER_GAP + trailH + WEEK_GAP
		BLOCKS.push({ height, top: y, trailTop: y + BANNER_H + BANNER_GAP })
		y += height
	}
}

// BLOCKS is built above, one entry per week, so it is never empty; the fallback keeps that a compile-time fact rather than an assertion.
const LAST = BLOCKS.at(-1) ?? { height: 0, top: 0, trailTop: 0 }
const PRIZE_TOP = LAST.top + LAST.height + 40
const PRIZE_CENTRE = PRIZE_TOP + PRIZE_H / 2
const STAGE_H = PRIZE_TOP + PRIZE_H + 140

/* ------------------------------------------------------------------ *
 * Timeline
 * ------------------------------------------------------------------ */
/** The title holds still long enough to read, then the camera lets go. */
const T_HOLD = 1400
/** Title to prize, one move. */
const T_FALL = 6800
const T_END = T_HOLD + T_FALL

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1)

/**
 * What the captions say, keyed to where the camera is rather than to the clock: each line appears as the weeks it describes come into frame, so a slow machine never has a caption naming weeks that are not on screen yet. The banners already name each week, so a caption says only what they don't.
 */
const article = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a")
const SCRIPT: { fromWeek: number; fromDepth: number; line(goal: string): string }[] = [
	{
		fromDepth: 0,
		fromWeek: 1,
		line: () => "This is your map. Every week is a set of checkpoints: journal your progress, film a reel, submit.",
	},
	{
		fromDepth: 0,
		fromWeek: 3,
		line: () => "Weeks 1 to 5, you design: a PCB, a 3D model, an instrument, a display and a breadboard computer.",
	},
	{
		fromDepth: 0,
		fromWeek: 6,
		line: () => "Weeks 6 to 10, the parts arrive and you build all five for real.",
	},
	{
		fromDepth: 0.94,
		fromWeek: 1,
		line: goal => `At the end, you get ${article(goal)} ${goal} shipped right to you!.`,
	},
]

/**
 * The fall's speed profile: it eases off the title like something starting to drop, runs fastest through the middle weeks, and spends its last stretch braking onto the prize. Asymmetric on purpose – a symmetric ease reads as a glide, and this is an arrival.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
	const cpx = 3 * x1
	const bpx = 3 * (x2 - x1) - cpx
	const apx = 1 - cpx - bpx
	const cpy = 3 * y1
	const bpy = 3 * (y2 - y1) - cpy
	const apy = 1 - cpy - bpy
	const sampleX = (t: number) => ((apx * t + bpx) * t + cpx) * t
	const slopeX = (t: number) => (3 * apx * t + 2 * bpx) * t + cpx
	return (x: number) => {
		let t = x
		for (let i = 0; i < 6; i += 1) {
			const slope = slopeX(t)
			if (Math.abs(slope) < 1e-6) break
			t -= (sampleX(t) - x) / slope
		}
		t = clamp01(t)
		return ((apy * t + bpy) * t + cpy) * t
	}
}
const fall = cubicBezier(0.5, 0, 0.12, 1)
const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t))
const smooth = (t: number) => t * t * (3 - 2 * t)

/* ------------------------------------------------------------------ *
 * Stage
 * ------------------------------------------------------------------ */
function MiniPanel({ className, children }: { className?: string; children?: React.ReactNode }) {
	return <div className={cx("rounded-2xl border-2 border-line bg-cream", className)}>{children}</div>
}

const KIND_ICON = {
	bonus: IconCoin,
	demo: IconUpload,
	journal: IconClock,
	onboarding: IconPlay,
	project: IconCoin,
	reel: IconFilm,
	submit: IconUpload,
} as const

function Stage({ goal }: { goal: PrinterGoal }) {
	return (
		<div className="relative" style={{ height: STAGE_H, width: STAGE_W }}>
			{/* ---- the shell, in frame while the camera is still at the top ---- */}
			<div className="absolute top-10 left-10 flex w-75 flex-col gap-5">
				<Gato className="h-auto w-[86px]" sizes="172px" />
				<MiniPanel className="px-5 py-4">
					{["Home", "Projects", "Reels", "Explore", "Shop"].map((l, i) => (
						<p
							className={cx(
								"border-b border-dashed border-line py-2.5 text-[1.05rem] last:border-0",
								i === 0 ? "font-extrabold text-navy" : "font-semibold text-navy-soft",
							)}
							key={l}
						>
							{l}
						</p>
					))}
				</MiniPanel>
				<MiniPanel className="relative overflow-hidden px-5 py-4">
					{/* as on the real goal card: the photo on its tile, inside the corner */}
					<PrinterPhoto
						className="absolute top-3 right-3 size-16 rounded-xl border border-line/80"
						id={goal.id}
						sizes="128px"
					/>
					<p className="max-w-[60%] text-[0.95rem] leading-snug font-semibold text-navy">
						You are on track to get a <span className="text-teal-ink">{goal.name}</span>
					</p>
					<div className="mt-3 h-4 w-full overflow-hidden rounded-full bg-mint">
						<div className="h-full w-[12%] rounded-full bg-teal" />
					</div>
				</MiniPanel>
				<MiniPanel className="flex items-center gap-3 p-3">
					<Avatar className="size-15 text-[1.5rem]" image={null} name="John Cena" shape="tile" />
					<div>
						<p className="text-[1rem] font-extrabold text-navy">John Cena</p>
						<p className="hand text-[0.82rem] text-navy-soft">@johncena</p>
					</div>
				</MiniPanel>
			</div>

			<span className="absolute top-0 left-95 h-220 w-px border-l border-dashed border-line" />

			<div className="absolute top-10 left-295 w-75">
				<MiniPanel className="p-3.5">
					<p className="label mb-3 text-navy-faint">The Doomscroller</p>
					<div className="flex flex-col gap-3">
						{MOCK_REELS.map(r => (
							<div
								className="relative overflow-hidden rounded-xl bg-navy"
								key={r.who}
								style={{ aspectRatio: "9 / 13" }}
							>
								<Image alt="" className="object-cover" fill sizes="552px" src={r.shot} />
								<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2.5 pt-8">
									<p className="text-[0.72rem] font-bold text-white">{r.who}</p>
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
									className="absolute"
									key={cp.id}
									style={{ left: nodeX(i) - PUCK / 2, top: b.trailTop + i * STEP, width: PUCK }}
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
							[0.35, 0.65].map(f => (
								<span
									className="absolute size-[6px] rounded-full bg-line-strong/45"
									key={`${i}-${f}`}
									style={{
										left: nodeX(i + f) - 3,
										top: b.trailTop + (i + f) * STEP + PUCK / 2 - 3,
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
				style={{ height: PRIZE_H, left: COL_X - 300, top: PRIZE_TOP, width: 600 }}
			>
				<PrinterPhoto className="mt-3 size-70 rounded-2xl border border-gold-deep/40" id={goal.id} sizes="560px" />
				<p className="mt-3 text-[2rem] leading-none font-extrabold tracking-[-0.03em] text-navy">{goal.name}</p>
				<p className="hand mt-2 text-[1rem] text-navy-soft">finish all ten weeks!</p>
			</div>
		</div>
	)
}

/**
 * The week banners are chrome, not scenery: like the real trail, each one parks at the top of the frame while its week is passing and is then shoved off by the next. They live in screen space so the camera loop can clamp them every frame – CSS sticky needs a scroll container, and the stage is a transform.
 */
function WeekBanners({ refs }: { refs: React.RefObject<(HTMLDivElement | null)[]> }) {
	return (
		<div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
			{WEEKS.map((week, i) => (
				<div
					className="absolute top-0 left-1/2"
					key={week.id}
					ref={el => {
						refs.current[i] = el
					}}
					style={{
						display: "none",
						height: BANNER_H,
						marginLeft: -380,
						transformOrigin: "center top",
						width: 760,
					}}
				>
					{/* The tear belongs to the plaque, never to the type. `.torn` is a displacement filter, so on a container it drags the glyphs about with the edges – and this one is re-scaled every frame by the camera, which rasterises the filtered result at one size and stretches it to another. The real trail's banner separates them the same way. */}
					<span aria-hidden="true" className="torn absolute inset-0 rounded" style={{ background: week.accent }} />
					<div className="relative flex h-full items-center gap-4 px-6" style={{ color: onAccent(week.accent).text }}>
						<div className="min-w-0 flex-1">
							<p className="label">
								Week {week.id}/10 · {week.phase === "design" ? "Design" : "Build"}
							</p>
							<p className="mt-0.5 truncate text-[1.6rem] leading-none font-extrabold tracking-[-0.025em]">
								{week.headline}
							</p>
						</div>
						<WeekPainting alt="" className="sticker-shadow size-14 shrink-0" sizes="112px" theme={week.theme} />
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
	const { setPhase, reducedMotion } = useStore()
	const camera = useRef<HTMLDivElement>(null)
	const banners = useRef<(HTMLDivElement | null)[]>([])
	const title = useRef<HTMLDivElement>(null)
	const landing = useRef<(() => void) | null>(null)
	const skipped = useRef(false)
	const [ended, setEnded] = useState(reducedMotion)
	const [beat, setBeat] = useState(reducedMotion ? SCRIPT.length - 1 : -1)
	/** Last painted camera position, so a skip can land from where it is. */
	const here = useRef({ fy: TITLE_Y, scale: 1 })

	// The diorama is built once and kept out of every re-render the captions trigger, so the fall stays a pure transform on a stable layer.
	const stage = useMemo(() => <Stage goal={GOAL} />, [])

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
		// The opening frame shows the platform around the title – but never so far out on a phone that the trail under it is a smudge.
		const openScale = () => Math.max(platformScale(), Math.min(trailScale(), 0.55))
		// The closing frame has to hold the whole prize card above the CTA.
		const CTA_ROOM = 190
		const prizeScale = () =>
			Math.min(Math.max(Math.min(window.innerWidth / 720, (window.innerHeight - CTA_ROOM) / 600), 0.3), 1)
		const prizeFocus = () => PRIZE_CENTRE + CTA_ROOM / 2 / prizeScale()

		/**
		 * One camera position, painted everywhere at once: the stage, the banners that stick at the top of the frame, and the title, which is anchored to the head of the trail but drawn at screen size so it reads on a phone. Returns the week whose banner is on top.
		 */
		const place = (fy: number, scale: number) => {
			const vh = window.innerHeight
			node.style.transform =
				`translate(-50%, -50%) scale(${scale.toFixed(4)}) `
				+ `translate(${STAGE_W / 2 - COL_X}px, ${STAGE_H / 2 - fy}px)`
			if (title.current) title.current.style.transform = `translateY(${((TITLE_Y - fy) * scale + vh / 2).toFixed(1)}px)`

			// Sticky, by hand: a banner tracks its block until the block reaches the top of the frame, holds there, then gets pushed up by the next.
			const h = BANNER_H * scale
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
			here.current = { fy, scale }
			return pinned < 0 ? WEEKS.length : pinned + 1
		}

		if (reducedMotion) {
			place(prizeFocus(), prizeScale())
			return
		}

		// A skip lands from wherever the camera is, so the banners and the title move with it instead of freezing mid-flight.
		landing.current = () => {
			const from = here.current
			const toFy = prizeFocus()
			const toScale = prizeScale()
			const t1 = performance.now()
			const land = (now: number) => {
				const k = easeOutExpo(clamp01((now - t1) / 700))
				place(lerp(from.fy, toFy, k), lerp(from.scale, toScale, k))
				if (k < 1) window.requestAnimationFrame(land)
			}
			window.requestAnimationFrame(land)
		}

		let raf = 0
		const t0 = performance.now()

		const frame = (now: number) => {
			if (skipped.current) return
			const t = now - t0
			// Everything below is one move: no pull-backs, no reversals. Until the hold is up the camera is parked on the title; after it, `depth` is how far down the run the camera is, title to prize.
			const p = clamp01((t - T_HOLD) / T_FALL)
			const depth = fall(p)
			const fy = lerp(TITLE_Y, prizeFocus(), depth)
			// Close in on the trail as the fall gathers speed, and open back out only for the landing, so the whole prize card arrives in frame.
			const cruising = lerp(openScale(), trailScale(), smooth(clamp01(p / 0.25)))
			const scale = lerp(cruising, prizeScale(), smooth(clamp01((depth - 0.86) / 0.14)))

			const week = place(fy, scale)

			let idx = -1
			if (t >= T_HOLD)
				for (let i = 0; i < SCRIPT.length; i += 1) {
					const s = SCRIPT[i]
					if (s && week >= s.fromWeek && depth >= s.fromDepth) idx = i
				}

			setBeat(b => (b === idx ? b : idx))

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
		setBeat(SCRIPT.length - 1)
		setEnded(true)
	}

	const line = beat >= 0 ? SCRIPT[beat] : null

	return (
		<div className="fixed inset-0 z-[90] overflow-hidden bg-cream">
			<div aria-hidden="true" className="absolute inset-0 z-0 overflow-hidden">
				<div
					className="absolute top-1/2 left-1/2 will-change-transform"
					ref={camera}
					style={{ height: STAGE_H, width: STAGE_W }}
				>
					{stage}
				</div>
			</div>

			<WeekBanners refs={banners} />

			{/* The title is part of the scene: it sits at the head of the trail and leaves the frame the way the weeks do, by the camera falling away from it. */}
			<div
				className="pointer-events-none absolute inset-x-0 top-0 z-20 px-6 text-center"
				ref={title}
				style={{ transform: "translateY(50vh)" }}
			>
				<div className="-translate-y-1/2">
					<div className="motion-safe:animate-[hl-rise_.6s_cubic-bezier(.16,1,.3,1)_both]">
						<Gato className="mx-auto h-auto w-[clamp(84px,13vw,132px)]" sizes="300px" />
						<h1 className="mt-5 text-[clamp(3rem,12vw,6rem)] leading-[0.86] font-extrabold tracking-[-0.04em] text-navy">
							HALF LIFE
						</h1>
						<p className="hand mt-4 text-[clamp(1rem,2.6vw,1.45rem)] text-navy-soft">
							ten weeks of hardware, five designs, five builds
						</p>
					</div>
				</div>
			</div>

			{/* caption */}
			{line && !ended && (
				<div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-20 sm:pb-12">
					<p
						className="sketch sketch-2 max-w-160 rounded-2xl bg-cream px-6 py-4 text-center text-[clamp(1.05rem,2.4vw,1.35rem)] leading-snug font-extrabold tracking-[-0.02em] text-balance text-navy lift-shadow motion-safe:animate-[hl-rise_.4s_cubic-bezier(.16,1,.3,1)_both]"
						key={beat}
						style={{ "--sk-color": "var(--color-navy)", "--sk-radius": "18px" }}
					>
						{line.line(GOAL.name)}
					</p>
				</div>
			)}

			{/* end CTA */}
			{ended && (
				<div className="absolute inset-x-0 bottom-0 z-20 flex justify-center px-5 pb-8 sm:pb-10">
					<div
						className="sketch sketch-2 w-full max-w-md rounded-3xl bg-cream px-6 py-4 text-center lift-shadow motion-safe:animate-[hl-rise_.5s_cubic-bezier(.16,1,.3,1)_both]"
						style={{ "--sk-color": "var(--color-gold-deep)", "--sk-radius": "26px" }}
					>
						<h2 className="text-[clamp(1.2rem,3.2vw,1.6rem)] leading-tight font-extrabold tracking-[-0.03em] text-navy">
							Become an expert in 10 weeks, get a 3D printer
						</h2>
						<Button className="mt-4" full onClick={() => setPhase("aim")} size="lg" variant="gold">
							Get started
						</Button>
					</div>
				</div>
			)}

			{!ended && (
				<button
					className="label absolute top-5 right-5 z-30 rounded-full border-2 border-line bg-cream/80 px-4 py-2 text-navy-soft backdrop-blur-sm transition-colors hover:border-navy hover:text-navy"
					onClick={skip}
					type="button"
				>
					Skip intro
				</button>
			)}
		</div>
	)
}
