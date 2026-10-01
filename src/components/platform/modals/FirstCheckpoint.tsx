"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { OnboardingFlow } from "@/app/components/forms/OnboardingFlow"
import { Button } from "@/components/platform/ui"
import type { OnboardingView } from "@/lib/onboarding-view"
import { useStore } from "@/lib/store"
import { Modal, ModalTitle } from "./Modal"

/**
 * The dashboard's Get started checkpoint. The standalone onboarding page is
 * intentionally not a second implementation: this modal consumes the same
 * `/api/onboarding` state machine and view model as the server flow.
 */
export function FirstCheckpoint() {
	const { setOpenCheckpoint, setPhase } = useStore()
	const router = useRouter()
	const [view, setView] = useState<OnboardingView | null>(null)
	const [error, setError] = useState<string | null>(null)
	const [attempt, setAttempt] = useState(0)

	useEffect(() => {
		let cancelled = false

		async function load() {
			setError(null)
			try {
				const response = await fetch("/api/onboarding", { cache: "no-store" })
				const payload = (await response.json().catch(() => null)) as {
					onboarding?: OnboardingView
					error?: { message?: string }
				} | null
				if (!response.ok || !payload?.onboarding) {
					throw new Error(payload?.error?.message ?? "The onboarding state could not be loaded")
				}
				if (!cancelled) setView(payload.onboarding)
			} catch (cause) {
				if (!cancelled) setError(cause instanceof Error ? cause.message : "The onboarding state could not be loaded")
			}
		}

		void load()
		return () => {
			cancelled = true
		}
	}, [attempt])

	const close = () => setOpenCheckpoint(null)

	if (error) {
		return (
			<Modal open onClose={close} accent="var(--color-gold-deep)" eyebrow="Getting started">
				<ModalTitle sub={error}>Something went wrong</ModalTitle>
				<Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
					Try again
				</Button>
			</Modal>
		)
	}

	if (!view) {
		return (
			<Modal open onClose={close} accent="var(--color-gold-deep)" eyebrow="Getting started">
				<p className="hand text-navy-soft">Loading your project setup…</p>
			</Modal>
		)
	}

	return (
		<Modal
			open
			onClose={close}
			accent="var(--color-gold-deep)"
			eyebrow="Getting started"
			size="xl"
			scrollKey={view.reached}
		>
			<OnboardingFlow
				initial={view}
				onComplete={() => {
					setOpenCheckpoint(null)
					setPhase("tour")
					router.refresh()
				}}
			/>
		</Modal>
	)
}
