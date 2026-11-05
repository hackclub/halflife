"use client"

import { useEffect, useState } from "react"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { setNpsNudgeActive } from "@/components/platform/modals/nps-nudge"
import { Button, Field, TextArea } from "@/components/platform/ui"
import { errorMessage } from "@/lib/api-error"
import { cx } from "@/lib/cx"
import { isRecord } from "@/lib/unknown"

const SCORE_HINT = ["Not at all likely", "", "", "", "", "", "", "", "", "", "Extremely likely"]

const SCORE_QUESTION = "How likely are you to recommend Half Life to a friend?"

/**
 * The 0-10 puck row, shared by the blocking score step and the follow-up where the score can be revised.
 */
function ScorePicker({
	hint,
	onChange,
	value,
}: {
	hint?: string
	onChange(score: number): void
	value: number | null
}) {
	return (
		<fieldset>
			<legend className="label text-coral-deep">
				{SCORE_QUESTION} <span aria-hidden="true">*</span>
			</legend>
			{hint && <p className="hand mt-1.5 text-[0.8rem] leading-snug text-navy-soft">{hint}</p>}
			<div aria-label={SCORE_QUESTION} className="mt-2.5 flex flex-wrap justify-between gap-1.5" role="radiogroup">
				{Array.from({ length: 11 }, (_, n) => (
					// biome-ignore lint/a11y/useSemanticElements: a score option drawn as a puck; a real input would replace the button.
					<button
						aria-checked={value === n}
						aria-label={SCORE_HINT[n] ? `${n} – ${SCORE_HINT[n]}` : String(n)}
						className={cx(
							"grid size-10 place-items-center rounded-xl border-2 text-[0.95rem] font-extrabold tabular-nums transition-colors",
							value === n
								? "border-coral-deep bg-coral-deep text-white"
								: "border-field bg-black/2 text-navy hover:border-navy-soft",
						)}
						key={n}
						onClick={() => onChange(n)}
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
	)
}

/**
 * The NPS flow in two steps, so the dashboard never opens with a wall of fields.
 *
 * The score is the gate: a blocking modal with only the 0-10 picker, and nothing behind it reachable until a score is saved. Once the score is in, the follow-up opens – also blocking, and also uncloseable until at least one text answer is sent. The score can be changed in that second step, defaulted to the one already saved.
 */
export function NpsGate() {
	const [loaded, setLoaded] = useState(false)
	const [skipped, setSkipped] = useState(false)
	const [score, setScore] = useState<number | null>(null)
	const [textsDone, setTextsDone] = useState(false)
	const [draft, setDraft] = useState<number | null>(null)
	const [savingScore, setSavingScore] = useState(false)
	const [scoreError, setScoreError] = useState<string | null>(null)
	const [textsScore, setTextsScore] = useState<number | null>(null)
	const [doingWell, setDoingWell] = useState("")
	const [improve, setImprove] = useState("")
	const [hear, setHear] = useState("")
	const [savingTexts, setSavingTexts] = useState(false)
	const [textsError, setTextsError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const res = await fetch("/api/me/nps", { cache: "no-store" })
				const payload: unknown = await res.json().catch(() => null)
				if (cancelled) return
				// A status that could not be read is not "no score": treating it as one parks the user behind a modal that cannot be dismissed or saved. Skipping the prompt is the failure mode that leaves the dashboard usable.
				if (!res.ok || !isRecord(payload)) {
					setSkipped(true)
					return
				}
				if (typeof payload.skipped === "string") setSkipped(true)
				if (typeof payload.score === "number") setScore(payload.score)
				if (payload.textsDone === true) setTextsDone(true)
			} catch {
				// Unreachable status never blocks, for the reason above.
				if (!cancelled) setSkipped(true)
			} finally {
				if (!cancelled) setLoaded(true)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	const needsScore = loaded && !skipped && score === null
	const showFollowUp = loaded && !skipped && score !== null && !textsDone
	const selectedTextsScore = textsScore ?? score
	const hasTexts = Boolean(doingWell.trim() || improve.trim() || hear.trim())

	// While the follow-up is up it owns the sticker promotion's corner, so the banner stands down.
	useEffect(() => {
		setNpsNudgeActive(showFollowUp)
		return () => setNpsNudgeActive(false)
	}, [showFollowUp])

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

	async function submitTexts() {
		if (savingTexts || !hasTexts) return
		setSavingTexts(true)
		setTextsError(null)
		try {
			const res = await fetch("/api/me/nps/texts", {
				body: JSON.stringify({
					...(selectedTextsScore !== null ? { howLikelyRecommend: selectedTextsScore } : {}),
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
			if (selectedTextsScore !== null) setScore(selectedTextsScore)
			setTextsDone(true)
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
									One tap and you&apos;re in – then a quick follow-up.
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
					<ModalTitle sub="Quick check-in before you carry on – the score first, then a short follow-up.">
						How is Half Life going?
					</ModalTitle>

					<ScorePicker onChange={setDraft} value={draft} />
				</Modal>
			)}

			{showFollowUp && (
				<Modal
					accent="var(--color-coral)"
					dismissible={false}
					footer={
						<>
							{textsError ? (
								<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
									{textsError}
								</p>
							) : hasTexts ? (
								<p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
									One answer is enough – then you&apos;re done.
								</p>
							) : (
								<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-navy-soft">
									Add at least one answer to carry on.
								</p>
							)}
							<Button disabled={savingTexts || !hasTexts} onClick={() => submitTexts()} variant="solid">
								{savingTexts ? "Sending…" : "Send feedback"}
							</Button>
						</>
					}
					onClose={() => {}}
					open
				>
					<ModalTitle sub="The score is the one you already gave us – change it if you like. Add at least one answer to carry on. No pressure, you can grill us if you want.">
						Tell us more
					</ModalTitle>

					<div className="grid gap-6">
						<ScorePicker
							hint="You can change the score before sending."
							onChange={setTextsScore}
							value={selectedTextsScore}
						/>

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

							<Field
								hint="Anything we can do? (we know review is slow!)"
								id="nps-improve"
								label="What could be better?"
							>
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
					</div>
				</Modal>
			)}
		</>
	)
}
