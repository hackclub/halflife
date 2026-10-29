"use client"

import { useEffect, useState } from "react"
import { IconX } from "@/components/platform/icons"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { setNpsNudgeActive } from "@/components/platform/modals/nps-nudge"
import { Button, Field, Panel, TextArea } from "@/components/platform/ui"
import { errorMessage } from "@/lib/api-error"
import { cx } from "@/lib/cx"
import { isRecord } from "@/lib/unknown"

const SCORE_HINT = ["Not at all likely", "", "", "", "", "", "", "", "", "", "Extremely likely"]

/** Dismissing the nudge is per device, like the rest of the ceremony in the store: a fresh laptop asks again. */
const NUDGE_DISMISSED_KEY = "nps-texts-dismissed"

/**
 * The NPS flow in two steps, so the dashboard never opens with a wall of fields.
 *
 * The score is the gate: a blocking modal with only the 0-10 picker, and nothing behind it reachable until a score is saved. Once the score is in, the dashboard opens and a small card takes the sticker promotion's corner – opening it shows the three optional text fields, dismissing it leaves them unasked on this device, and any text on the row stops the nudge everywhere.
 */
export function NpsGate() {
	const [loaded, setLoaded] = useState(false)
	const [skipped, setSkipped] = useState(false)
	const [score, setScore] = useState<number | null>(null)
	const [textsDone, setTextsDone] = useState(false)
	const [draft, setDraft] = useState<number | null>(null)
	const [savingScore, setSavingScore] = useState(false)
	const [scoreError, setScoreError] = useState<string | null>(null)
	const [textsOpen, setTextsOpen] = useState(false)
	const [dismissed, setDismissed] = useState(false)
	const [submitted, setSubmitted] = useState(false)
	const [doingWell, setDoingWell] = useState("")
	const [improve, setImprove] = useState("")
	const [hear, setHear] = useState("")
	const [savingTexts, setSavingTexts] = useState(false)
	const [textsError, setTextsError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				if (window.localStorage.getItem(NUDGE_DISMISSED_KEY) === "1") setDismissed(true)
			} catch {
				// A locked-down store keeps the nudge: failing closed here would silence feedback with no say.
			}
			try {
				const res = await fetch("/api/me/nps", { cache: "no-store" })
				const payload: unknown = await res.json().catch(() => null)
				if (cancelled || !res.ok || !isRecord(payload)) return
				if (typeof payload.skipped === "string") setSkipped(true)
				if (typeof payload.score === "number") setScore(payload.score)
				if (payload.textsDone === true) setTextsDone(true)
			} catch {
				// Unreachable status never blocks: a prompt that cannot load its state must not park the user.
			} finally {
				if (!cancelled) setLoaded(true)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	const needsScore = loaded && !skipped && score === null
	const showNudge = loaded && !skipped && score !== null && !textsDone && !dismissed && !submitted

	// While the nudge is up it owns the sticker promotion's corner, so the banner stands down.
	useEffect(() => {
		setNpsNudgeActive(showNudge)
		return () => setNpsNudgeActive(false)
	}, [showNudge])

	async function submitScore() {
		if (draft === null || savingScore) return
		setSavingScore(true)
		setScoreError(null)
		try {
			const res = await fetch("/api/me/nps", {
				body: JSON.stringify({ howLikelyRecommend: draft }),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload: unknown = await res.json().catch(() => null)
			if (!res.ok) {
				setScoreError(errorMessage(payload, `Your score was not saved (${res.status}). Try again.`))
				return
			}
			setScore(draft)
		} catch {
			setScoreError("Could not reach the server. Nothing was saved. Try again.")
		} finally {
			setSavingScore(false)
		}
	}

	function dismissNudge() {
		try {
			window.localStorage.setItem(NUDGE_DISMISSED_KEY, "1")
		} catch {
			// Private mode keeps the nudge for the session; still hide it now.
		}
		setDismissed(true)
	}

	async function submitTexts() {
		if (savingTexts) return
		setSavingTexts(true)
		setTextsError(null)
		try {
			const res = await fetch("/api/me/nps/texts", {
				body: JSON.stringify({
					...(doingWell.trim() ? { howDoingWell: doingWell.trim() } : {}),
					...(hear.trim() ? { howHear: hear.trim() } : {}),
					...(improve.trim() ? { howImprove: improve.trim() } : {}),
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload: unknown = await res.json().catch(() => null)
			if (!res.ok) {
				setTextsError(errorMessage(payload, `Your feedback was not saved (${res.status}). Try again.`))
				return
			}
			try {
				window.localStorage.setItem(NUDGE_DISMISSED_KEY, "1")
			} catch {
				// See dismissNudge.
			}
			setSubmitted(true)
			setTextsOpen(false)
		} catch {
			setTextsError("Could not reach the server. Nothing was saved. Try again.")
		} finally {
			setSavingTexts(false)
		}
	}

	return (
		<>
			{needsScore && (
				<Modal
					accent="var(--color-coral)"
					dismissible={false}
					footer={
						<>
							{scoreError ? (
								<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
									{scoreError}
								</p>
							) : (
								<p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
									One tap and you&apos;re in – the details can wait.
								</p>
							)}
							<Button disabled={draft === null || savingScore} onClick={() => submitScore()} variant="solid">
								{savingScore ? "Sending…" : "Send feedback"}
							</Button>
						</>
					}
					onClose={() => {}}
					open
				>
					<ModalTitle sub="Quick check-in before you carry on – just the one question, and then you can get back to the dashboard.">
						How is Half Life going?
					</ModalTitle>

					<fieldset>
						<legend className="label text-coral-deep">
							How likely are you to recommend Half Life to a friend? <span aria-hidden="true">*</span>
						</legend>
						<div
							aria-label="How likely are you to recommend Half Life to a friend?"
							className="mt-2.5 flex flex-wrap justify-between gap-1.5"
							role="radiogroup"
						>
							{Array.from({ length: 11 }, (_, n) => (
								// biome-ignore lint/a11y/useSemanticElements: a score option drawn as a puck; a real input would replace the button.
								<button
									aria-checked={draft === n}
									aria-label={SCORE_HINT[n] ? `${n} – ${SCORE_HINT[n]}` : String(n)}
									className={cx(
										"grid size-10 place-items-center rounded-xl border-2 text-[0.95rem] font-extrabold tabular-nums transition-colors",
										draft === n
											? "border-coral-deep bg-coral-deep text-white"
											: "border-field bg-black/2 text-navy hover:border-navy-soft",
									)}
									key={n}
									onClick={() => setDraft(n)}
									role="radio"
									type="button"
								>
									{n}
								</button>
							))}
						</div>
						<div aria-hidden="true" className="mt-1.5 flex justify-between text-[0.72rem] text-navy-soft">
							<span>Not at all likely</span>
							<span>Extremely likely</span>
						</div>
					</fieldset>
				</Modal>
			)}

			{showNudge && !textsOpen && (
				<Panel
					className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom,0px)+5.4rem)] z-[60] w-[min(20rem,calc(100vw-1.5rem))] bg-cream p-4 pr-11 shadow-[0_3px_6px_rgba(28,26,89,.12),0_18px_40px_-16px_rgba(28,26,89,.55)] lg:right-6 lg:bottom-6"
					radius={16}
				>
					<p className="label text-coral-deep">Quick follow-up</p>
					<p className="mt-1 text-[0.9rem] leading-snug font-extrabold text-navy">Got 30 seconds to say more?</p>
					<p className="hand mt-1 text-[0.78rem] leading-snug text-navy-soft">
						What&apos;s going well, what could be better – only if you want to.
					</p>
					<Button className="mt-3" onClick={() => setTextsOpen(true)} size="sm" variant="solid">
						Share feedback
					</Button>
					<button
						aria-label="Dismiss the feedback nudge"
						className="absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-lg text-navy-soft transition-colors hover:bg-black/5 hover:text-navy"
						onClick={dismissNudge}
						title="Dismiss"
						type="button"
					>
						<IconX className="text-sm" />
					</button>
				</Panel>
			)}

			{textsOpen && (
				<Modal
					accent="var(--color-coral)"
					footer={
						<>
							{textsError ? (
								<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
									{textsError}
								</p>
							) : (
								<Button onClick={() => setTextsOpen(false)} variant="ghost">
									Not now
								</Button>
							)}
							<Button disabled={savingTexts} onClick={() => submitTexts()} variant="solid">
								{savingTexts ? "Sending…" : "Send feedback"}
							</Button>
						</>
					}
					onClose={() => setTextsOpen(false)}
					open
				>
					<ModalTitle sub="Anything you want to add – all three are optional, and sending it blank counts too.">
						Tell us more
					</ModalTitle>

					<div className="grid gap-5">
						<Field hint="Anything that is working for you." id="nps-doing-well" label="What is going well?">
							<TextArea
								id="nps-doing-well"
								maxLength={2000}
								onChange={e => setDoingWell(e.target.value)}
								placeholder="The trail, the reels, the guides…"
								rows={3}
								value={doingWell}
							/>
						</Field>

						<Field hint="Anything that would make it better." id="nps-improve" label="What could be better?">
							<TextArea
								id="nps-improve"
								maxLength={2000}
								onChange={e => setImprove(e.target.value)}
								placeholder="Be honest – this is what it's for."
								rows={3}
								value={improve}
							/>
						</Field>

						<Field
							hint="A friend, Slack, an email, social media…"
							id="nps-hear"
							label="How did you hear about Half Life?"
						>
							<TextArea
								id="nps-hear"
								maxLength={2000}
								onChange={e => setHear(e.target.value)}
								placeholder="Where did you first hear about us?"
								rows={2}
								value={hear}
							/>
						</Field>
					</div>
				</Modal>
			)}
		</>
	)
}
