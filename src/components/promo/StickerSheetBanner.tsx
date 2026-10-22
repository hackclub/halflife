"use client"

import Image from "next/image"
import { usePathname } from "next/navigation"
import { useEffect, useRef, useSyncExternalStore } from "react"
import { cx } from "@/lib/cx"
import bgArt from "../../../public/art/bg.png"
import logoArt from "../../../public/brand/logo.png"
import { getPromoMode, getServerPromoMode, setPromoMode, subscribePromo } from "./promo-state"
import styles from "./sticker-sheet-banner.module.css"

/**
 * The weeks 3 + 4 challenge, as a strip across the top of the site.
 *
 * The banner is in flow rather than fixed: it is the first thing on the page,
 * the platform header's own sticky behaviour still works underneath it, and it
 * scrolls away like the announcement it is. Closing it collapses it to the
 * floating card in the bottom-right, which is also the way back — the card's
 * copy is a button that reopens the banner and scrolls to it.
 *
 * The two root layouts mount it. The site's is static and the platform's is
 * session-gated, so the choice lives in localStorage and the boot script in
 * that layout hides the server-rendered banner before paint when it should not
 * be there. See `promo-state.ts` and `PromoBootScript.tsx`.
 *
 * The copy is the challenge itself, not a slogan: a participant should be able
 * to read the whole offer without following the CTA.
 */
export function StickerSheetBanner({
	platform = false,
	href = "#signup",
	cta = "Join the challenge",
}: {
	/** On the platform, keep the card above the phone tab bar and off the Doomscroller. */
	platform?: boolean
	href?: string
	cta?: string
}) {
	const pathname = usePathname()
	const mode = useSyncExternalStore(subscribePromo, getPromoMode, getServerPromoMode)
	const bannerRef = useRef<HTMLElement>(null)
	const cardCopyRef = useRef<HTMLButtonElement>(null)
	const pendingFocus = useRef<"banner" | "card" | null>(null)

	const onDoomscroller = platform && pathname.startsWith("/doomscroller")

	useEffect(() => {
		if (pendingFocus.current === "card" && mode === "card") {
			pendingFocus.current = null
			cardCopyRef.current?.focus({ preventScroll: true })
			return
		}

		if (pendingFocus.current === "banner" && mode === "banner") {
			pendingFocus.current = null
			bannerRef.current?.focus({ preventScroll: true })
			// The banner is at the top of the document; bringing it back while
			// the reader is halfway down the trail is not an offer, it is a
			// teleport. Move the page to where the reopened banner is.
			const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
			window.scrollTo({ behavior: reduce ? "auto" : "smooth", top: 0 })
		}
	}, [mode])

	if (mode === "hidden" || onDoomscroller) return null

	const card = mode === "card"

	const collapse = () => {
		pendingFocus.current = "card"
		setPromoMode("card")
	}

	const expand = () => {
		pendingFocus.current = "banner"
		setPromoMode("banner")
	}

	const dismiss = () => setPromoMode("hidden")

	return (
		<aside
			aria-label="Weeks 3 and 4 sticker sheet promotion"
			className={cx(styles.root, card ? styles.card : styles.banner)}
			data-platform={platform ? "true" : undefined}
			ref={bannerRef}
			tabIndex={card ? undefined : -1}
		>
			<div aria-hidden="true" className={styles.media}>
				<Image
					alt=""
					className={styles.image}
					fetchPriority="low"
					fill
					loading="eager"
					quality={60}
					sizes="100vw"
					src={bgArt}
				/>
			</div>
			<div aria-hidden="true" className={styles.scrim} />

			<div className={card ? styles.cardInner : styles.inner}>
				{card && (
					<span className={styles.logo}>
						<Image alt="" className={styles.logoImage} sizes="(min-width: 1024px) 88px, 68px" src={logoArt} />
					</span>
				)}

				{card ? (
					<button className={styles.copyButton} onClick={expand} ref={cardCopyRef} type="button">
						<span className={styles.eyebrow}>Weeks 3 &amp; 4</span>
						<span className={styles.headline}>Ship a project both weeks,<br />win a sticker sheet</span>
						<span className={styles.detail}>Requires an approved project for both weeks 3 and 4. Click to reopen.</span>
					</button>
				) : (
					<div className={styles.copy}>
						<p className={styles.eyebrow}>Weeks 3 &amp; 4 challenge</p>
						<p className={styles.headline}>Ship a project both weeks to win a free Half Life sticker sheet!</p>
						<p className={styles.detail}>A music project for week 3 and a display project for week 4.</p>
					</div>
				)}

				<a className={styles.cta} href={href}>
					{cta}
				</a>

				<button
					aria-label={card ? "Dismiss the sticker sheet promotion" : "Collapse the sticker sheet promotion"}
					className={styles.close}
					onClick={card ? dismiss : collapse}
					title={card ? "Dismiss" : "Collapse"}
					type="button"
				>
					<svg
						aria-hidden="true"
						fill="none"
						stroke="currentColor"
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={1.8}
						viewBox="0 0 24 24"
					>
						<path d="M6 6l12 12M18 6 6 18" />
					</svg>
				</button>
			</div>
		</aside>
	)
}
