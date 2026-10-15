"use client"

import { useState } from "react"
import { signInWith, useSession } from "@/lib/auth-client"

/**
 * The way back in, pinned to the painting's top-right corner.
 *
 * It answers the flag across the top edge: the Hack Club flag hangs from the top-left, this hangs from the top-right, and the dateline centres between them. Same material as the dateline – flat ink, square corners, no border, no shadow, the one container this system has – so it reads as a third mark mounted on the scene rather than as a nav bar that crept in.
 *
 * Paper on ink rather than a cyan block. Cyan is the sign-up CTA's colour one viewport below, and the two are not equals: signing up is what the page is
 * for, logging in is for the people it has already persuaded. The accent
 * arrives only on hover, as it does on every other link on this ink.
 *
 * Two vertical positions, following the dateline's own switch at 830px.
 * - At 830 and up the dateline sits at `top-3`, one line tall, and this takes the same row: `top-3`, the same `py-2.5`, the same 16px line, so the two plates share a top edge and a height. The dateline is 578px wide at most and centred, so the gap between them is (vw - 578) / 2 - 12 - this plate's width; at 830 that is about 30px, and it only opens from there.
 * - Below 830 the dateline drops to 3.25rem to clear the flag, and this does what the flag does instead: hangs at `top-1` and stays under 2.52rem tall, so the dateline clears it by the same 11.6px it clears the flag by.
 *
 * Pressing it goes straight to Hack Club's sign-in and comes back to the trail, rather than stopping at the platform's own sign-in page to ask the same question again. Someone already signed in has nothing to sign in to, so for them it is just the way to the trail. It stays a real link to /dashboard underneath, which is where a signed-in visitor opening it in a new tab belongs. If the sign-in could not start, the mark says "try again" and the page stays where it is: nothing on the site sends anyone to /login.
 */
export default function LoginMark() {
	const { data: session } = useSession()
	const [starting, setStarting] = useState(false)
	const [failed, setFailed] = useState(false)

	async function signIn(e: React.MouseEvent<HTMLAnchorElement>) {
		// Signed in already, or a modified click (new tab, and so on): let the link do what links do.
		if (session || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
		e.preventDefault()
		if (starting) return
		setStarting(true)
		try {
			// better-auth reports a refusal in the result rather than throwing, and on success the page is already on its way to Hack Club.
			const result = await signInWith("hca", "/dashboard")
			if (result?.error) fail()
		} catch {
			fail()
		}
	}

	// Stays on the landing page and says so on the mark itself, rather than sending anyone to a separate sign-in page.
	function fail() {
		setStarting(false)
		setFailed(true)
	}

	return (
		<a
			href="/dashboard"
			onClick={e => signIn(e)}
			aria-busy={starting || undefined}
			className="absolute top-1 right-1 z-20 bg-hl-ink px-3.5 py-1.5 font-display font-bold leading-snug text-hl-paper transition-colors hover:text-hl-cyan focus-visible:text-hl-cyan aria-busy:text-hl-cyan min-[830px]:top-3 min-[830px]:right-3 min-[830px]:px-5 min-[830px]:py-2.5"
			style={{ fontSize: "clamp(0.875rem, 3.6vw, 1rem)" }}
		>
			{failed ? "try again" : "log in"}
		</a>
	)
}
