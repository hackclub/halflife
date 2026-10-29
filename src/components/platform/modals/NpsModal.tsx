"use client"

import { useEffect, useState } from "react"
import { Modal, ModalTitle } from "@/components/platform/modals/Modal"
import { Button, Field, TextArea } from "@/components/platform/ui"
import { errorMessage } from "@/lib/api-error"
import { cx } from "@/lib/cx"
import { isRecord } from "@/lib/unknown"

const SCORE_HINT = ["Not at all likely", "", "", "", "", "", "", "", "", "", "Extremely likely"]

/**
 * The blocking NPS prompt on the dashboard. It stays up – no close button, no backdrop or Escape dismissal, nothing behind it reachable – until a score is saved. Only the score is required; the three text answers may be left empty and still submit.
 */
export function NpsGate() {
	const [checked, setChecked] = useState(false)
	const [needed, setNeeded] = useState(false)
	const [score, setScore] = useState<number | null>(null)
	const [doingWell, setDoingWell] = useState("")
	const [improve, setImprove] = useState("")
	const [hear, setHear] = useState("")
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		let cancelled = false
		void (async () => {
			try {
				const res = await fetch("/api/me/nps", { cache: "no-store" })
				const payload: unknown = await res.json().catch(() => null)
				if (cancelled || !res.ok) return
				if (isRecord(payload) && payload.completed === false) setNeeded(true)
			} catch {
				// Unreachable status never blocks: a prompt that cannot load its state must not park the user.
			} finally {
				if (!cancelled) setChecked(true)
			}
		})()
		return () => {
			cancelled = true
		}
	}, [])

	async function submit() {
		if (score === null || saving) return
		setSaving(true)
		setError(null)
		try {
			const res = await fetch("/api/me/nps", {
				body: JSON.stringify({
					...(doingWell.trim() ? { howDoingWell: doingWell.trim() } : {}),
					...(hear.trim() ? { howHear: hear.trim() } : {}),
					...(improve.trim() ? { howImprove: improve.trim() } : {}),
					howLikelyRecommend: score,
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload: unknown = await res.json().catch(() => null)
			if (!res.ok) {
				setError(errorMessage(payload, `Your feedback was not saved (${res.status}). Try again.`))
				return
			}
			setNeeded(false)
		} catch {
			setError("Could not reach the server. Nothing was saved. Try again.")
		} finally {
			setSaving(false)
		}
	}

	if (!checked || !needed) return null

	return (
		<Modal
			accent="var(--color-coral)"
			dismissible={false}
			footer={
				<>
					{error ? (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
							{error}
						</p>
					) : (
						<p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
							You can keep using Half Life as soon as this is sent.
						</p>
					)}
					<Button disabled={score === null || saving} onClick={() => submit()} variant="solid">
						{saving ? "Sending…" : "Send feedback"}
					</Button>
				</>
			}
			onClose={() => {}}
			open
		>
			<ModalTitle sub="Quick check-in before you carry on – it should take less than a minute, and then you can get back to the dashboard.">
				How is Half Life going?
			</ModalTitle>

			<div className="grid gap-5">
				<fieldset>
					<legend className="label text-coral-deep">
						How likely are you to recommend Half Life to a friend? <span aria-hidden="true">*</span>
					</legend>
					<div
						aria-label="How likely are you to recommend Half Life to a friend?"
						className="mt-2.5 flex flex-wrap gap-1.5"
						role="radiogroup"
					>
						{Array.from({ length: 11 }, (_, n) => (
							// biome-ignore lint/a11y/useSemanticElements: a score option drawn as a puck; a real input would replace the button.
							<button
								aria-checked={score === n}
								aria-label={SCORE_HINT[n] ? `${n} – ${SCORE_HINT[n]}` : String(n)}
								className={cx(
									"grid size-10 place-items-center rounded-xl border-2 text-[0.95rem] font-extrabold tabular-nums transition-colors",
									score === n
										? "border-coral-deep bg-coral-deep text-white"
										: "border-field bg-black/[.02] text-navy hover:border-navy-soft",
								)}
								key={n}
								onClick={() => setScore(n)}
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

				<Field hint="Anything that is working for you." id="nps-doing-well" label="What is going well? (optional)">
					<TextArea
						id="nps-doing-well"
						maxLength={2000}
						onChange={e => setDoingWell(e.target.value)}
						placeholder="The trail, the reels, the guides…"
						rows={3}
						value={doingWell}
					/>
				</Field>

				<Field hint="Anything that would make it better (we know review is slow!)." id="nps-improve" label="What could be better? (optional)">
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
					label="How did you hear about Half Life? (optional)"
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
	)
}
