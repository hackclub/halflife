"use client"

import Image from "next/image"
import { useRouter } from "next/navigation"
import { type CSSProperties, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { signInWith, useSession } from "@/lib/auth-client"
import { BRAND } from "@/lib/site/content"
import { SWASH_INSET_X, SWASH_INSET_Y } from "@/lib/site/stage"
import brushstroke from "../../../public/art/brushstroke.png"

type Status = "idle" | "pending" | "error"

/**
 * The way in. Sizing is entirely `em`-relative, so the caller sets one font-size and the field, the button and the paddings all follow – the comp stage passes a `cqw` value, the stacked mobile layout passes a `clamp()`.
 *
 * "sign up/log in" does exactly that now: it signs in with Hack Club, the account the platform runs on, carrying the address typed here as the sign-in's `login_hint`. Hack Club Auth pre-fills its email box from that, and that box is where a returning user logs in and where a newcomer starts the account they do not have yet – so nobody types their address twice. Someone already signed in has nothing to sign in to and goes straight to the trail.
 *
 * The address is still recorded as a sign-up on the way, because the referral code and campaign in this page's own URL exist nowhere else.
 */
export default function SignupForm({
	className = "",
	fontSize,
	style,
	intro,
}: {
	className?: string
	fontSize?: string
	style?: CSSProperties
	/**
	 * Anything that belongs inside the field's own box – in practice the hero's tagline.
	 *
	 * It is a slot here rather than a sibling in the hero because of where the box has to stop. The line under the field is the eligibility note, and it has to stay outside: it is a footnote about who may sign up, not part of the offer, and boxing it with the promise would read as fine print on a coupon. The note lives in this component, so the only way to draw a box around the caption and the field but not around it is for the box to be drawn in here too.
	 */
	intro?: ReactNode
}) {
	const id = useId()
	const router = useRouter()
	const { data: session } = useSession()
	const [status, setStatus] = useState<Status>("idle")
	const [message, setMessage] = useState("")
	const inputRef = useRef<HTMLInputElement>(null)

	/**
	 * Prefill from the address bar: `?email=someone@example.com`. A link sent out with the address already in it lands on a field that is filled in and one click from done, which is the whole point of sending it that way.
	 *
	 * Read off `window.location` in an effect rather than through `useSearchParams`, for the same reason the submit handler reads it that way: the hook would pull this component – and so the hero above it – out of the prerender and behind a Suspense boundary, to save a value that only matters once the field is interactive anyway. The input is uncontrolled, so writing straight onto the node after mount costs no render and cannot mismatch hydration.
	 *
	 * It never overwrites: if someone has already typed, or the browser has restored a value on a back-navigation, what is in the field wins.
	 */
	useEffect(() => {
		const params = new URLSearchParams(window.location.search)
		const prefill = params.get("email")?.trim()
		if (prefill && inputRef.current && !inputRef.current.value) {
			inputRef.current.value = prefill
		}
		// A callback that could not attach the Hack Club identity sends the person back here with a flag, so they meet an explanation on the field they sign in with rather than an empty page. The common case – a staff-imported row that was never verified – is repaired automatically at the callback (lib/hca-profile), so this is the remainder.
		if (params.get("error") === "account_not_linked") {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- reading the redirect flag after hydration
			setStatus("error")
			setMessage("We couldn't link your Hack Club account. Try again, or reach out in Slack.")
		}
	}, [])

	function fail(text: string) {
		setStatus("error")
		setMessage(text)
		inputRef.current?.focus()
	}

	async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault()
		const field = inputRef.current
		const email = field?.value.trim() ?? ""

		// Checked here rather than by the browser (`noValidate`), so the message lands on the line under the field in this page's voice instead of in a native bubble.
		if (!email) return fail("Enter your email to sign up or log in.")
		if (field && !field.checkValidity()) return fail("That doesn't look like an email address.")

		setStatus("pending")
		setMessage("Taking you to Hack Club to sign in…")

		// Whoever sent this visitor here – a referral link or a campaign URL – is only present in this page's own address bar, so it's read fresh at submit time and sent before the page leaves. `keepalive` lets it finish even if the sign-in navigates away first, and its answer is not needed, so it is deliberately NOT awaited: awaiting a slow or rate-limited signup would put the list provider between the visitor and the way in. (This used to await with an AbortController that fired after 2.5s – but aborting cancels the request, so a slow signup was silently dropped rather than "left to finish on its own".)
		const params = new URLSearchParams(window.location.search)
		void fetch("/api/subscribe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			keepalive: true,
			body: JSON.stringify({
				email,
				ref: params.get("ref") || undefined,
				utmSource: params.get("utm_source") || undefined,
				utmMedium: params.get("utm_medium") || undefined,
				utmCampaign: params.get("utm_campaign") || undefined,
			}),
		}).catch(() => {
			// Slow, offline or refused: none of it should stand between someone and signing in. The sign-in below says so if the network is really gone.
		})

		if (session) {
			router.push("/dashboard")
			return
		}

		try {
			// better-auth reports a refusal in the result rather than throwing; on success the page is already on its way to Hack Club.
			const result = await signInWith("hca", "/dashboard", email)
			if (result?.error) fail("Hack Club sign-in didn't open. Give it another try in a moment.")
		} catch {
			fail("You look offline. Reconnect and try again.")
		}
	}

	const pending = status === "pending"

	return (
		<div className={className} style={{ ...style, fontSize }}>
			{/* The box: the promise and the field it is asking you to fill, grouped,
          with the eligibility note left outside it below.

          Its ground is the painted swash rather than flat ink. The tagline is
          paper and reads 6.95:1 on it at the worst pixel the painting can put
          behind it, against the 3.50:1 it had bare on the hero plate, so the
          box is still the better ground for the line – and the field's own
          cyan edge reads 7.45:1 here where on ink it had 3.71:1, so the one
          boundary that had to be argued for is now the easy part.

          The padding was `pt-[1rem] pb-[1rem] p-[2rem]`, three utilities for one
          box, and the `p` lost: Tailwind emits it ahead of the two axis rules,
          so 2rem was only ever the horizontal value and the vertical 1rem was
          doing the work. It is one declaration now, and both numbers are
          derived – see `SWASH_INSET_X`.

          `isolate` keeps the swash's negative index inside this box instead of
          letting it escape to the nearest stacking context and paint behind
          the hero plate, which is to say behind nothing. */}
			<div
				className={intro ? "relative isolate mb-[1rem]" : ""}
				style={
					intro
						? {
								paddingInline: `${SWASH_INSET_X * 100}%`,
								paddingBlock: SWASH_INSET_Y,
							}
						: undefined
				}
			>
				{intro ? (
					<>
						{/* Decorative: the promise is the sentence over it, and a brush
                mark carries nothing a reader needs. Through `next/image` rather
                than as a CSS `background-image` so the 487 KB PNG is served
                resized and re-encoded on the hero, where it would otherwise
                land whole in the middle of the largest paint on the page.

                `object-fill` is the deliberate one: `cover` would crop the ends
                that are the only thing distinguishing this from a rectangle,
                `contain` would letterbox them, and the interior is flat colour,
                so stretching it to a box that runs 6.8:1 in the stage and 3:1
                on a phone costs nothing but the angle of the two tapers. */}
						<Image
							src={brushstroke}
							alt=""
							aria-hidden
							fill
							sizes="(min-width: 1180px) 1110px, 100vw"
							quality={90}
							className="-z-10 object-fill"
						/>
						{/* The 0.7em that separates the promise from the field. It was
                `mb-[0.7em]` and generated no rule at all, so the two were flush:
                the sentence sat directly on the slot it is asking you to
                fill. */}
						<div style={{ marginBottom: "0.7em" }}>{intro}</div>
					</>
				) : null}

				{/* The row is the positioning context for the confirmation plate, so
            the plate is exactly the field's footprint and nothing below it ever
            moves. overflow-hidden keeps the wipe's cut edge crisp. */}
				<div className="relative overflow-hidden">
					<form onSubmit={onSubmit} noValidate className="flex w-full">
						<label htmlFor={id} className="sr-only">
							email address
						</label>
						{/* The field is a slot cut into the hero plate, not a control
                sitting on it: ink ground, one soft cyan edge, and an input that
                carries no surface of its own – no background, no border, no ring
                of its own, because the slot is the control. The cyan caret is
                the only accent, and it is only there while someone is typing.

                It briefly also carried the image slot's registration ticks, its
                measured grid and an uppercase legend. At 33px tall none of that
                resolved: the grid ran three cells deep and the ticks were 8px
                specks, so it read as detail for its own sake rather than as an
                instrument. One surface, one boundary, one accent does the job
                the five of them were failing to. */}
						<div
							className={`hl-field relative min-w-0 flex-1 bg-hl-ink ${pending ? "opacity-70" : ""}`}
							style={{ height: "2.1667em" }}
						>
							<input
								ref={inputRef}
								id={id}
								name="email"
								type="email"
								autoComplete="email"
								inputMode="email"
								required
								disabled={pending}
								placeholder="email address"
								// Always described by the line below: the eligibility note when there is nothing wrong, the error when there is. Pointing at it only on error meant the note was on screen but not in the accessibility tree.
								aria-describedby={`${id}-msg`}
								aria-invalid={status === "error" || undefined}
								onChange={() => {
									if (status === "error") {
										setStatus("idle")
										setMessage("")
									}
								}}
								// Display face, not the body one it inherited. The control is one object – a slot cut into the plate and the word beside it – and "sign up/log in" is set in the display face, so the field's own type belongs to the same voice. Set on the input rather than scoped to `::placeholder`, so the address someone types does not change face out from under them mid-word.
								className="h-full w-full bg-transparent px-[0.667em] font-display text-hl-paper caret-hl-cyan outline-none placeholder:text-hl-paper-soft"
							/>

							{/* Edge at 55% rather than the slot component's 45%: on ink that
                  is 3.71:1 where 45% is 2.96, and this boundary belongs to a
                  control rather than to a picture. */}
							<span
								aria-hidden
								className="hl-field-edge pointer-events-none absolute inset-0 border-2 border-hl-cyan"
							/>
						</div>

						{/* The label, not a glyph. A check meant "done" on a control whose
                job is "start" – the one place on the page where the tick is
                honest is the confirmation that wipes over the field once the
                address is in, which is where it still lives.

                Padding rather than a fixed 2.8em width, so the button is as
                wide as its word: 5.34em, which the field gives up out of its
                own flex-1. At the narrowest phone that leaves the field 163px
                against the 125px its placeholder needs.

                Label and spinner share one grid cell, so the label reserves the
                button's width even while hidden and a submit cannot resize the
                row under the pointer. `invisible` and not `opacity-0` because
                visibility:hidden also takes the label out of the accessibility
                tree, which lets the pending name be the only one there.

                "sign up/log in" is nearly twice the word "sign up!" was, and on
                a phone the swash's inset leaves the row about 175px at 320: on one
                line it left the field 58px there and 108 at 390, against the
                ~120 "email address" needs. Below 520 it stacks at the slash
                instead, and the button's side padding tightens to match a word half
                as wide. Two lines at 0.85em and `leading-none`, plus the gap,
                are 1.82em of the button's 2.1667, so the row keeps its height
                and the field gets back the second half's width. */}
						<button
							type="submit"
							disabled={pending}
							className="grid shrink-0 place-items-center bg-hl-cyan px-[0.6em] text-hl-ink transition-colors hover:bg-white focus-visible:bg-white disabled:cursor-progress disabled:bg-hl-blue min-[520px]:px-[0.9em]"
							style={{ height: "2.1667em" }}
						>
							<span
								className={`[grid-area:1/1] flex flex-col items-center gap-[0.12em] font-display font-bold leading-none min-[520px]:flex-row min-[520px]:gap-0 ${
									pending ? "invisible" : ""
								}`}
								style={{ fontSize: "0.85em" }}
							>
								<span className="whitespace-nowrap">sign up/</span>
								<span className="whitespace-nowrap">log in</span>
							</span>
							{pending ? (
								<>
									<Spinner className="h-[0.9em] w-[0.9em] animate-spin [grid-area:1/1]" />
									<span className="sr-only">Taking you to Hack Club to sign in</span>
								</>
							) : null}
						</button>
					</form>
				</div>
			</div>

			{/* One line under the field, carrying the eligibility note until there
          is an error to carry instead. It was already reserving this height
          with a transparent space so an error could never move the plate
          above it, so the note costs no layout and the swap costs none
          either – the error takes a line that is already lit rather than
          opening a new one, and the note is what the field is described by
          the rest of the time.

          Paper, not the soft tint the placeholder uses: this sits on the
          hero plate rather than in the field's own ink slot, and the plate is
          only 60% opaque over the painting – soft paper falls to 3.44:1
          there, where paper holds 5.28:1. Regular weight against the error's
          semibold, so the two read apart at a glance as well as by colour. */}
			<p
				id={`${id}-msg`}
				className={`mt-[0.45em] ${status === "error" ? "font-semibold text-hl-cyan" : "text-hl-paper"}`}
				style={{ fontSize: "0.6em", minHeight: "1.4em" }}
			>
				{status === "error" ? message : BRAND.eligibility}
			</p>

			{/* One persistent live region does all the announcing – "taking you to
          Hack Club", or what went wrong. It is always in the tree, so every
          status change is a change to it, and it carries no layout. */}
			<p role="status" aria-live="polite" className="sr-only">
				{message}
			</p>
		</div>
	)
}

function Spinner({ className }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
			<circle cx={12} cy={12} r={9} stroke="currentColor" strokeWidth={3} strokeOpacity={0.3} />
			<path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="square" />
		</svg>
	)
}
