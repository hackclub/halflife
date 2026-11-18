"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { getNpsNudgeActive, subscribeNpsNudgeActive } from "@/components/platform/modals/nps-nudge"
import { Button, LinkButton } from "@/components/platform/ui"
import {
	ADDRESS_REMINDER_KEY,
	ADDRESS_REMINDER_SNOOZE_MS,
	addressReminderDue,
	parseDismissedAt,
} from "@/lib/address-reminder"
import { useStoredValue, writeStored } from "@/lib/browser-state"
import { useStore } from "@/lib/store"
import { isRecord } from "@/lib/unknown"

/** Where a maker adds or checks the address we ship to. */
const ADDRESSES_URL = "https://auth.hackclub.com/addresses"

/** How long after coming back to the tab the answer may be asked again, so a return from HCA is not a second read per glance. */
const RECHECK_AFTER_MS = 30_000

/** Snooze the reminder for a snooze window, through the browser store so every mounted reader sees it at once. */
function snooze(): void {
	writeStored(ADDRESS_REMINDER_KEY, String(Date.now()))
}

async function readNeeded(): Promise<boolean | null> {
	try {
		const res = await fetch("/api/me/shipping-address", { cache: "no-store" })
		const payload: unknown = await res.json().catch(() => null)
		if (!res.ok || !isRecord(payload)) return null
		return payload.needed === true
	} catch {
		// An unreachable check leaves the reminder off; the next page load asks again.
		return null
	}
}

/**
 * Warns a maker whose parts are funded but have nowhere to go.
 *
 * The same shape as the NPS prompt and mounted in the shell rather than on one page, because an approved design is no longer something you only look at on the trail. It is dismissible, unlike NPS, and comes back after an hour (lib/address-reminder) – the work stays approved and unshipped however many times it is closed.
 *
 * It waits its turn: the intro ceremony, the goal question, an open checkpoint and the NPS prompt all own the screen first, so this never opens two dialogs at once. Return from Hack Club Auth and it checks again, so an address added while it was open makes it disappear rather than linger for the rest of the snooze.
 */
export function AddressReminder({ blocked = false }: { blocked?: boolean }) {
	const { hydrated, openCheckpoint, participantGoal, phase } = useStore()
	// Read through the browser store, so a dismissal on another tab counts here too and nothing has to copy storage into state.
	const dismissedAt = parseDismissedAt(useStoredValue(ADDRESS_REMINDER_KEY))
	const [needed, setNeeded] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [now, setNow] = useState(() => Date.now())
	const npsActive = useSyncExternalStore(subscribeNpsNudgeActive, getNpsNudgeActive, () => false)

	useEffect(() => {
		let cancelled = false
		void (async () => {
			const result = await readNeeded()
			if (cancelled) return
			if (result !== null) setNeeded(result)
			setLoaded(true)
		})()
		return () => {
			cancelled = true
		}
	}, [])

	// Someone leaving for HCA and coming back is the one moment the answer really can change; ask again then, but no more often than the throttle.
	useEffect(() => {
		if (!needed) return
		let lastChecked = Date.now()
		const onVisible = () => {
			if (document.visibilityState !== "visible" || Date.now() - lastChecked < RECHECK_AFTER_MS) return
			lastChecked = Date.now()
			void (async () => {
				const result = await readNeeded()
				if (result !== null) setNeeded(result)
			})()
		}
		document.addEventListener("visibilitychange", onVisible)
		return () => document.removeEventListener("visibilitychange", onVisible)
	}, [needed])

	// Wake up exactly when a snooze runs out. `now` only moves then, so the reminder is derived rather than opened by an effect.
	useEffect(() => {
		if (dismissedAt === null) return
		const left = dismissedAt + ADDRESS_REMINDER_SNOOZE_MS - Date.now()
		if (left <= 0) return
		const timer = setTimeout(() => setNow(Date.now()), left)
		return () => clearTimeout(timer)
	}, [dismissedAt])

	const ceremonyDone = hydrated && phase === "done"
	const due = addressReminderDue(dismissedAt, now)
	const canShow =
		loaded
		&& needed
		&& due
		&& !blocked
		&& ceremonyDone
		&& participantGoal !== null
		&& openCheckpoint === null
		&& !npsActive

	return (
		<Modal
			accent="var(--color-coral)"
			footer={
				<>
					<p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
						We&apos;ll ask again in an hour if it&apos;s still missing.
					</p>
					<Button onClick={snooze} variant="ghost">
						Remind me later
					</Button>
					<LinkButton href={ADDRESSES_URL} rel="noopener noreferrer" target="_blank" variant="coral">
						Add my address
					</LinkButton>
				</>
			}
			onClose={snooze}
			open={canShow}
		>
			<ModalTitle sub="Your design was approved, but there's no mailing address on your Hack Club account – so we have nowhere to send the parts.">
				We can&apos;t ship your parts yet
			</ModalTitle>

			<p className="text-[0.92rem] leading-relaxed text-navy-soft">
				Add a mailing address in Hack Club Auth and we&apos;ll pick it up automatically. You don&apos;t need to tell us
				here – once it&apos;s saved there, this reminder goes away.
			</p>
		</Modal>
	)
}
