"use client"

import { IconArrowRight, IconCheck } from "@/components/platform/icons"
import { Button } from "@/components/platform/ui"
import { WARMUP_WEEK_ID } from "@/lib/config/program"
import type { Checkpoint } from "@/lib/types"
import { Modal } from "./Modal"
import { FilesStep, PartsStep, ReelStep, SubmitNotices } from "./SubmitSteps"
import { type SubmitSheet, useSubmitSheet } from "./submit-sheet"

function SubmitFooter({ sheet }: { sheet: SubmitSheet }) {
	const {
		canAdvance,
		closeSheet,
		firmwareMissing,
		nextBlocker,
		otherRepoBlocker,
		owed,
		repoReady,
		repoResult,
		setStep,
		step,
		submit,
		submitError,
		submitting,
		total,
		week,
	} = sheet
	// One read of the reason, so the line and the disabled button cannot disagree on the same render.
	const blocker = step > 1 && !submitError ? nextBlocker() : null

	return (
		<>
			<Button onClick={() => (step === 1 ? closeSheet() : setStep(s => s - 1))} variant="outline">
				{step === 1 ? "Not yet" : "Back"}
			</Button>
			{submitError && (
				<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
					{submitError}
				</p>
			)}
			{step === 1 && !submitError && !repoReady && repoResult && (
				<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep">
					{firmwareMissing && !otherRepoBlocker
						? "Tick the box above if your project has no microcontroller, or add its firmware."
						: "Fix the repo checks above to carry on."}
				</p>
			)}
			{step === 1 && !submitError && !repoReady && repoResult === null && (
				<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-navy-soft" role="status">
					Checking your repo…
				</p>
			)}
			{blocker && (
				<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
					{blocker}
				</p>
			)}
			{step < total ? (
				<Button disabled={!canAdvance} onClick={() => setStep(s => s + 1)} variant="solid">
					Next <IconArrowRight className="text-base" />
				</Button>
			) : (
				<Button disabled={!canAdvance || submitting} onClick={() => submit()} variant="coral">
					{submitting
						? "Submitting…"
						: owed > 0
							? "Submit anyway"
							: week.id === WARMUP_WEEK_ID
								? "Submit warm-up"
								: `Submit week ${week.id}`}{" "}
					<IconCheck className="text-base" />
				</Button>
			)}
		</>
	)
}

export function SubmitModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const sheet = useSubmitSheet(checkpoint)
	const { closeSheet, isBuild, step, week } = sheet

	return (
		<Modal
			accent="var(--color-magenta)"
			eyebrow={`Submit ${week.id === WARMUP_WEEK_ID ? "your warm-up" : `week ${week.id}`} · ${step}/${sheet.total}`}
			footer={<SubmitFooter sheet={sheet} />}
			onClose={() => closeSheet()}
			open
			scrollKey={step}
			size="lg"
		>
			<SubmitNotices sheet={sheet} />

			{step === 1 && <FilesStep sheet={sheet} />}
			{!isBuild && step === 2 && <PartsStep sheet={sheet} />}
			{((isBuild && step === 2) || (!isBuild && step === 3)) && <ReelStep sheet={sheet} />}
		</Modal>
	)
}
