"use client"

import { useEffect, useState } from "react"
import { IconChevronDown, IconChevronUp } from "@/components/platform/icons"
import { useStore } from "@/lib/store"

/** The sticky header's height: what a week banner sits under, and what a jump has to clear. */
const HEADER = 64

/**
 * A way back to the week being worked on, once the trail has carried the reader away from it.
 *
 * The trail is one scroll through all ten weeks, which is the point of it – but a maker who scrolls down to see what is coming, or back up to reread an old entry, can be several screens from the node they were on. The arrow appears only when the current week's banner has left the viewport, pointing back the way the week went: up once later weeks are in front, down when earlier ones are.
 *
 * It is a button rather than a link because it moves the page, not the route. The week is found from `currentCheckpointId`, so a warm-up (which has no season week) has nothing for it to point at and the button stays away.
 */
export function CurrentWeekButton() {
	const { currentCheckpointId, weeks } = useStore()
	const week = weeks.find(w => w.checkpoints.some(c => c.id === currentCheckpointId)) ?? null
	const [side, setSide] = useState<"above" | "below" | null>(null)

	useEffect(() => {
		if (!week) {
			setSide(null)
			return
		}
		const section = document.querySelector<HTMLElement>(`[data-week="${week.id}"]`)
		const banner = section?.querySelector<HTMLElement>("[data-week-banner]")
		if (!section || !banner) return

		// Checked on a slow tick rather than on scroll: the page scrolls in more than one way (wheel, keyboard, a restored position, the jump itself), and one interval covers them all without a listener per source. Four times a second is enough for a control that only appears once a week has left the frame.
		const check = () => {
			const box = banner.getBoundingClientRect()
			setSide(box.bottom <= HEADER ? "above" : box.top >= window.innerHeight ? "below" : null)
		}
		check()
		const timer = window.setInterval(check, 250)
		return () => window.clearInterval(timer)
	}, [week])

	if (!week || !side) return null

	const label = `Go to week ${week.id}`

	return (
		<button
			aria-label={label}
			className="current-week-jump sketch sticker-shadow fixed z-40 grid size-11 place-items-center rounded-full bg-paper text-navy-soft transition-[color,transform] duration-150 hover:text-navy active:translate-y-px"
			onClick={() => {
				const section = document.querySelector<HTMLElement>(`[data-week="${week.id}"]`)
				if (!section) return
				window.scrollTo({ behavior: "smooth", top: section.getBoundingClientRect().top + window.scrollY - HEADER })
			}}
			style={{ "--sk-color": "var(--color-line)", "--sk-radius": "999px" }}
			title={label}
			type="button"
		>
			{side === "above" ? <IconChevronUp className="text-[1.15rem]" /> : <IconChevronDown className="text-[1.15rem]" />}
		</button>
	)
}
