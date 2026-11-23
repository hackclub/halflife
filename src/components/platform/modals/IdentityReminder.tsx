"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import {
	getAddressReminderOpen,
	subscribeAddressReminderOpen,
} from "@/components/platform/modals/address-reminder-open"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { getNpsNudgeActive, subscribeNpsNudgeActive } from "@/components/platform/modals/nps-nudge"
import { Button, LinkButton } from "@/components/platform/ui"
import { parseDismissedAt } from "@/lib/address-reminder"
import { useStoredValue, writeStored } from "@/lib/browser-state"
import { IDENTITY_REMINDER_KEY, IDENTITY_REMINDER_SNOOZE_MS, identityReminderDue } from "@/lib/identity-reminder"
import { useStore, useStoreUi } from "@/lib/store"
import { isRecord } from "@/lib/unknown"

/** Where a maker goes to verify their identity with Hack Club. */
const VERIFY_URL = "https://auth.hackclub.com"

/** How long after coming back to the tab the answer may be asked again, so a return from HCA is not a second read per glance. */
const RECHECK_AFTER_MS = 30_000

/** Snooze the reminder for a day, through the browser store so every mounted reader sees it at once. */
function snooze(): void {
	writeStored(IDENTITY_REMINDER_KEY, String(Date.now()))
}

async function readNeeded(): Promise<boolean | null> {
	try {
		const res = await fetch("/api/me/identity", { cache: "no-store" })
		const payload: unknown = await res.json().catch(() => null)
		if (!res.ok || !isRecord(payload)) return null
		return payload.needed === true
	} catch {
		// An unreachable check leaves the reminder off; the next page load asks again.
		return null
	}
}

/**
 * Asks an approved maker to verify their identity with Hack Club.
 *
 * The same shape as the address reminder, and a nudge rather than a gate: it can be closed, it comes back a day later, and nothing on the site waits for it. Verification is slow on HCA's side, so the copy says so and says the work can carry on in the meantime. It waits its turn like the other prompts, and it re-checks when the maker returns from HCA so a finished verification makes it go away.
 */
export function IdentityReminder({ blocked = false }: { blocked?: boolean }) {
	const { participantGoal } = useStore()
	const { hydrated, openCheckpoint, phase } = useStoreUi()
	const dismissedAt = parseDismissedAt(useStoredValue(IDENTITY_REMINDER_KEY))
	const [needed, setNeeded] = useState(false)
	const [loaded, setLoaded] = useState(false)
	const [now, setNow] = useState(() => Date.now())
	const npsActive = useSyncExternalStore(subscribeNpsNudgeActive, getNpsNudgeActive, () => false)
	const addressOpen = useSyncExternalStore(subscribeAddressReminderOpen, getAddressReminderOpen, () => false)

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

	// Wake up exactly when a snooze runs out, rather than polling for it.
	useEffect(() => {
		if (dismissedAt === null) return
		const left = dismissedAt + IDENTITY_REMINDER_SNOOZE_MS - Date.now()
		if (left <= 0) return
		const timer = setTimeout(() => setNow(Date.now()), left)
		return () => clearTimeout(timer)
	}, [dismissedAt])

	const ceremonyDone = hydrated && phase === "done"
	const due = identityReminderDue(dismissedAt, now)
	const canShow =
		loaded
		&& needed
		&& due
		&& !blocked
		&& ceremonyDone
		&& participantGoal !== null
		&& openCheckpoint === null
		&& !npsActive
		&& !addressOpen

	return (
		<Modal
			accent="var(--color-coral)"
			footer={
				<>
					<p className="hand hidden min-w-0 flex-1 text-[0.78rem] text-navy-soft sm:block">
						We&apos;ll check again when you come back.
					</p>
					<Button onClick={snooze} variant="ghost">
						Remind me tomorrow
					</Button>
					<LinkButton href={VERIFY_URL} rel="noopener noreferrer" target="_blank" variant="coral">
						Verify my identity
					</LinkButton>
				</>
			}
			onClose={snooze}
			open={canShow}
		>
			<ModalTitle sub="Your design is approved, and grants and shop orders wait on this. Hack Club takes a while to check, so there is nothing you need to do while you wait: keep building, and this goes away once it is done.">
				Verify your identity
			</ModalTitle>

			<p className="text-[0.92rem] leading-relaxed text-navy-soft">
				Verify with Hack Club Auth. Once it is confirmed, we pick it up the next time you come back to Half Life.
			</p>
		</Modal>
	)
}
