"use client"

import { useEffect, useState } from "react"
import { COUNTDOWN_UNITS, countdownParts, pad2 } from "@/lib/site/countdown"

/**
 * The programme's week, as a large plate across the top of the landing page: a countdown before it opens, the running week's number once it has.
 *
 * What it is timed against is the programme's own schedule – the opening instant of every week – fetched from `/api/program`, which is where the site already reads program settings from. It is NOT read during the page's render, deliberately: the landing page is statically generated, so a `getProgramSettings()` call in its tree made the build hit the database, and a build host with no route to Postgres failed the whole deploy on a socket timeout. Both the countdown and the sign-up counter are client decorations that fetch their own data, so the page itself stays static and the build needs no database at all.
 *
 * The week is worked out here from that schedule rather than asked for once, because the plate ticks every second and a landing-page tab sits open across a Monday more often than one would like: a number written at load and never revisited reads "week 1 is open" for the whole of every week after it. Read against the clock, it turns over on its own.
 *
 * Two things it has to get right, and both are about the server/client seam:
 *
 * - **No hydration mismatch.** The server renders the placeholder and the browser hydrates later; a live figure on the server would disagree and React would rewrite the markup on every load. The stable placeholder (unit labels with `--`) is what both the server and the client's first paint show, and the ticking figure appears only once mounted, in an effect. Before the first answer the plate keeps its height, so nothing under it moves when the number lands.
 * - **Ends cleanly.** At zero the countdown stops and the plate names the week that opened, so it never counts into the negative; once the last week has passed it says the programme is over, rather than claiming a tenth week is running forever.
 *
 * The count is split into days/hours/minutes/seconds rather than one string, so each unit is its own large figure with a small label beneath – the same figure-leads, words-follow relationship the sign-up counter uses, taken to the four columns a countdown wants.
 *
 * It is a solid cyan plate with ink text, the page's CTA material: the sign-up button is `bg-hl-cyan text-hl-ink`, and a countdown to opening day is the same kind of object – an offer the page is making – rather than the muted dateline it replaced. `rounded-lg` plus the global `* { corner-shape: bevel }` (globals.css) makes the corners the page's own 45° mitre, and the short shadow in the section's deep teal lifts it off the painting.
 */

export default function WeekCountdown() {
	// The opening instant of every week, in ms, week 1 first, and the programme's last; null until the endpoint answers.
	const [schedule, setSchedule] = useState<{ opens: number[]; endsAt: number } | null>(null)
	const [now, setNow] = useState<number | null>(null)

	// The schedule is fixed, so it is fetched once. A failure leaves the plate showing its placeholder – a countdown is never worth a visible error, the same rule the sign-up counter follows.
	useEffect(() => {
		let live = true
		void (async () => {
			try {
				const res = await fetch("/api/program", { cache: "no-store" })
				if (!res.ok) return
				const body = (await res.json()) as { weekOpensAt?: unknown; programEndsAt?: unknown }
				if (!live || !Array.isArray(body.weekOpensAt) || typeof body.programEndsAt !== "string") return
				setSchedule({
					opens: body.weekOpensAt.map(at => new Date(String(at)).getTime()),
					endsAt: new Date(body.programEndsAt).getTime(),
				})
			} catch {
				// Offline or the endpoint is down: keep the placeholder.
			}
		})()
		return () => {
			live = false
		}
	}, [])

	useEffect(() => {
		const tick = () => setNow(Date.now())
		tick()
		const timer = setInterval(tick, 1000)
		return () => clearInterval(timer)
	}, [])

	/**
	 * How many weeks have opened – which is the week running, since the programme runs one to ten. Null until the schedule lands, and that is what holds the placeholder up.
	 */
	const opened = schedule !== null && now !== null ? schedule.opens.filter(at => at <= now).length : null
	const over = schedule !== null && now !== null && now >= schedule.endsAt
	const counting = opened === null || opened === 0
	const label = counting ? "week 1 starts in" : over ? "the program is over" : `week ${opened} is open`
	const firstOpen = schedule?.opens[0] ?? null
	const parts = counting && firstOpen !== null && now !== null ? countdownParts(firstOpen - now) : null

	// The plate, cut from the page's cyan the way the sign-up CTA is: a solid ground with ink text, `rounded-lg` and the global `corner-shape: bevel` turning that radius into a 45° mitre. It sits as high as it can without meeting the flag and log-in marks at the corners – `top-12` clears both – and the gap under it is what keeps it off the wordmark in the plate below.
	return (
		<div className="pointer-events-none absolute top-10 left-1/2 z-20 -translate-x-1/2 min-[830px]:top-12">
			<div
				aria-live="polite"
				className="inline-block max-w-[92vw] rounded-lg bg-hl-cyan px-4 py-1.5 text-center text-hl-ink shadow-[0_2px_0_var(--color-hl-teal-deep)]"
			>
				<p className="font-display text-[0.66rem] font-bold uppercase tracking-[0.18em]">{label}</p>
				{counting ? (
					<div
						className="mt-0.5 flex items-baseline justify-center gap-[0.4em] font-display font-bold tabular-nums"
						style={{ fontSize: "clamp(1.5rem, 6vw, 2.25rem)", lineHeight: 1 }}
					>
						{COUNTDOWN_UNITS.map(unit => (
							<span className="inline-flex flex-col items-center" key={unit.key} style={{ lineHeight: 1 }}>
								<span style={{ fontSize: "1em" }}>
									{parts === null ? "--" : unit.key === "days" ? parts.days : pad2(parts[unit.key])}
								</span>
								<span
									className="font-display font-bold uppercase"
									style={{ fontSize: "0.24em", letterSpacing: "0.14em", lineHeight: 1 }}
								>
									{unit.label}
								</span>
							</span>
						))}
					</div>
				) : null}
			</div>
		</div>
	)
}
