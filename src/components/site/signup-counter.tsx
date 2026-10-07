"use client"

import { useEffect, useState } from "react"

/** How often to ask again. A number that moves is the point; a fast poll is not. */
const REFRESH_MS = 60_000

/**
 * "N people have signed up", boxed, under the sign-up form – below the email field and the eligibility line beneath it (see the hero for why not between the two). Salience is the whole argument for the box. Directly under a line of small print, a line of small type would read as more of it; this is social proof, so it is one of the page's own reserved slots – the same ink ground and cyan edge the email field is cut from (`hl-field`, globals.css) – which puts it in the sign-up action's own visual family while keeping it a thing you look at rather than type into.
 *
 * The number leads and the words follow it, at roughly half the size: the figure is what the eye should catch, and "people have signed up" explains it once caught. Split across two lines rather than one sentence, because a single run of mixed-size text would set the number as just another word.
 *
 * Live in the sense that matters here: it fetches once on mount and then on an interval, so a visitor who leaves the tab open watches it climb rather than reading whatever the number was when the page was built.
 *
 * It is a client component for that reason alone. Rendering the count on the server would tie the hero to the database and to a dynamic render, and the number is social proof rather than content – the page is exactly as useful with it absent, which is the state it starts in and the state it falls back to if the request fails.
 *
 * Before the first answer the box keeps its height and dims its contents rather than collapsing, so nothing around it jumps when the number lands. `aria-live="polite"` because a number that changes while someone is reading it should say so, and the initial fill is worth one announcement rather than none.
 */
export default function SignupCounter({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
	const [count, setCount] = useState<number | null>(null)

	useEffect(() => {
		let live = true

		async function read() {
			try {
				const res = await fetch("/api/signup-count", { cache: "no-store" })
				if (!res.ok) return
				const body = (await res.json()) as { count?: unknown }
				if (live && typeof body.count === "number") setCount(body.count)
			} catch {
				// Offline, or the endpoint is down: keep the last number we had, or none at all. A counter is never worth a visible error.
			}
		}

		void read()
		const timer = setInterval(() => void read(), REFRESH_MS)
		return () => {
			live = false
			clearInterval(timer)
		}
	}, [])

	return (
		<p
			// `rounded-xl` is the cut the below-fold plates use (`process.tsx`, `build-carousel.tsx`), and the global `* { corner-shape: bevel }` in globals.css turns that radius into a mitre: a straight 45° cut rather than an arc. So the box matches the plates below the fold without drawing anything itself – the same radius and the same global bevel.
			className={`inline-block rounded-xl bg-hl-ink px-[1.1em] py-[0.5em] text-hl-paper transition-opacity ${className}`}
			// The edge is a border rather than the field's overlaid <span>, because there is nothing underneath this box for a second layer to register against. 2px and cyan at full strength – the field's own live colour – so the two read as the same family of slot.
			style={{ ...style, border: "2px solid var(--color-hl-cyan)", opacity: count === null ? 0 : 1 }}
			aria-live="polite"
		>
			{count === null ? null : (
				// One sentence, with the figure nested inside it rather than a sibling of the words. Split into two flex items the two are separated by a gap the text does not contain, so the accessible name came out "5,203people have signed up" – the space lived in the layout and not in the sentence. Here it is a real space, and the size difference is what carries the emphasis.
				//
				// Centred on each other, not sat on one baseline: at half the figure's size, baseline-aligned words hung off the bottom of the number. So both are `align-middle` – their midpoints land on the same line of the one inline run – which is the flex `items-center` look without becoming flex items and losing the space again.
				<>
					{/* `tabular-nums` so the box does not shift width as the count gains
              a digit. */}
					<span
						className="align-middle font-display font-bold tabular-nums"
						style={{ fontSize: "1.5em", lineHeight: 1 }}
					>
						{count.toLocaleString("en-US")}
					</span>{" "}
					<span className="align-middle font-display" style={{ fontSize: "0.75em" }}>
						people have signed up
					</span>
				</>
			)}
		</p>
	)
}
