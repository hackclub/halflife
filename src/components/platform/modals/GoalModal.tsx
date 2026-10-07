"use client"

import { useId, useState } from "react"
import { ParticipantGoal } from "@/app/generated/prisma/enums"
import { PrinterPhoto } from "@/components/platform/art"
import { IconCheck, IconClock, IconCoin } from "@/components/platform/icons"
import { Button, cx, OptionRow } from "@/components/platform/ui"
import { GOAL_OPTIONS } from "@/lib/config/goal"
import { PRINTERS, type PrinterGoal, printerById, weeksToGo } from "@/lib/config/printers"
import { BUILD_HOURS } from "@/lib/curriculum"
import { useStore } from "@/lib/store"
import { Modal, ModalTitle } from "./Modal"

const TEAL = "var(--color-teal-deep)"

type Step = "goal" | "printer"

/**
 * What you're here for, and – only if the answer is a printer – which machine.
 *
 * The order is the point. The catalogue is eight machines priced against each other, and it is a meaningless question to somebody who is here for the grant and never wanted a printer; so the goal is always asked first and the machines are only ever shown to someone who has said they want one. Reversing the two is what would make a fifteen-year-old read eight prices to work out a question they hadn't been asked.
 *
 * The same modal does both jobs. The rail's tracker and the phone's "Change printer" open it to change an answer; the prompt after the first checkpoint opens it uncloseable, and is driven by `participantGoal` still being null rather than by anything in this file.
 */
export function GoalModal({
	open,
	onClose,
	/** False for the mandatory prompt, which has nowhere to go until answered. */
	dismissible = true,
}: {
	open: boolean
	onClose: () => void
	dismissible?: boolean
}) {
	const { goalId, participantGoal, printerFund, setParticipantGoal } = useStore()
	const [step, setStep] = useState<Step>("goal")
	const [chosen, setChosen] = useState<ParticipantGoal>(ParticipantGoal.PRINTER)
	const [picked, setPicked] = useState(goalId)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const titleId = useId()

	// Reopening starts from whatever is taped up now, including a goal that changed elsewhere – adjusting during render beats an effect that repaints. Opening always lands on the goal question, never mid-catalogue, so the answer is never edited by accident on the way to changing the machine.
	const [seen, setSeen] = useState({ open, goalId, participantGoal })
	if (seen.open !== open || seen.goalId !== goalId || seen.participantGoal !== participantGoal) {
		setSeen({ open, goalId, participantGoal })
		setStep("goal")
		setChosen(participantGoal ?? ParticipantGoal.PRINTER)
		setPicked(goalId)
		setError(null)
	}

	const goal = printerById(picked)
	const unchanged = picked === goalId
	const toGo = Math.max(0, goal.coins - printerFund)
	const weeks = weeksToGo(goal, printerFund)

	async function commit(goalAnswer: ParticipantGoal, printer?: string) {
		setSaving(true)
		setError(null)
		const refusal = await setParticipantGoal(goalAnswer, printer)
		setSaving(false)
		// A refusal keeps the sheet open with the reason on it. Closing here would leave the mandatory prompt looking finished when nothing was saved.
		if (refusal) {
			setError(refusal)
			return
		}
		onClose()
	}

	function advance() {
		setError(null)
		if (chosen === ParticipantGoal.PRINTER) setStep("printer")
		else commit(chosen)
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			accent={TEAL}
			size={step === "goal" ? "md" : "xl"}
			labelledBy={titleId}
			eyebrow={dismissible ? "Your goal" : "One more thing"}
			dismissible={dismissible}
			scrollKey={step}
			footer={
				<>
					{error && (
						<p role="alert" className="hand mr-auto w-full text-[0.82rem] leading-snug text-coral-deep sm:w-auto">
							{error}
						</p>
					)}
					{step === "goal" ? (
						<>
							{dismissible && (
								<Button variant="outline" onClick={onClose}>
									Cancel
								</Button>
							)}
							<Button variant="teal" onClick={advance} disabled={saving}>
								Continue <IconCheck className="text-base" />
							</Button>
						</>
					) : (
						<>
							<p className="mr-auto w-full text-[0.82rem] leading-snug text-navy-soft sm:w-auto sm:max-w-[44ch]">
								<span className="font-extrabold text-navy">{goal.name}</span>
								{toGo > 0 ? (
									weeks > 0 ? (
										<>
											{" – "}
											<span className="tabular-nums">{toGo.toLocaleString()}</span> coins to go: about{" "}
											{Math.round(goal.paceHours * 5)} coins a week to earn for {weeks} design weeks{" "}
										</>
									) : (
										<>
											{" – "}
											<span className="tabular-nums">{toGo.toLocaleString()}</span> coins to go, and the build weeks
											cover it at {BUILD_HOURS * 5} coins a week.{" "}
										</>
									)
								) : (
									<> you&apos;ve reached this printer goal! </>
								)}
								<a
									href={goal.link}
									target="_blank"
									rel="noreferrer"
									className="font-semibold whitespace-nowrap text-sky-ink underline decoration-dashed underline-offset-4 transition-colors hover:text-navy"
								>
									Link to printer
								</a>
							</p>
							<Button variant="ghost" onClick={() => setStep("goal")} disabled={saving}>
								Back
							</Button>
							{dismissible && (
								<Button variant="outline" onClick={onClose}>
									Cancel
								</Button>
							)}
							<Button variant="teal" disabled={saving} onClick={() => commit(ParticipantGoal.PRINTER, picked)}>
								{unchanged ? "Keep this goal" : "Set this goal"} <IconCheck className="text-base" />
							</Button>
						</>
					)}
				</>
			}
		>
			{step === "goal" ? (
				<>
					<ModalTitle
						id={titleId}
						sub={
							dismissible
								? "Change this whenever you like – it decides what we build the rest of the season around."
								: "Last thing before you get going! It decides what we build the rest of the season around, and you can change it whenever you like."
						}
					>
						What are you here for?
					</ModalTitle>

					<div role="radiogroup" aria-labelledby={titleId} className="mt-2 grid gap-3">
						{GOAL_OPTIONS.map((option) => (
							<OptionRow
								key={option.value}
								selected={option.value === chosen}
								onClick={() => setChosen(option.value)}
								hint={option.hint}
							>
								<span className="block text-[0.98rem] font-extrabold text-navy">{option.label}</span>
							</OptionRow>
						))}
					</div>
				</>
			) : (
				<>
					<ModalTitle
						id={titleId}
						subWide
						sub="Spend more time on your hardware projects to unlock better printers! You can change this goal anytime you'd like."
					>
						What&apos;s your big prize?
					</ModalTitle>

					<div role="radiogroup" aria-labelledby={titleId} className="grid gap-x-4 gap-y-6 sm:grid-cols-2">
						{PRINTERS.map((p) => (
							<GoalCard
								key={p.id}
								goal={p}
								current={p.id === goalId}
								selected={p.id === picked}
								onSelect={() => setPicked(p.id)}
							/>
						))}
					</div>
				</>
			)}
		</Modal>
	)
}

/* A button, so every child below has to be phrasing content – spans, not divs. */
function GoalCard({
	goal,
	selected,
	current,
	onSelect,
}: {
	goal: PrinterGoal
	selected: boolean
	current: boolean
	onSelect: () => void
}) {
	const load = Math.round((goal.paceHours / Math.max(...PRINTERS.map((p) => p.paceHours))) * 100)

	return (
		// biome-ignore lint/a11y/useSemanticElements: a radio option drawn as a card; a real input would replace the card.
		<button
			type="button"
			role="radio"
			aria-checked={selected}
			onClick={onSelect}
			title={`About ${Math.round(goal.paceHours * 5)} coins to earn each design week – that pace is the same on every tier, because tier hours pay for parts while every hour past them earns. Bigger printers cost more coins to earn each week.`}
			className={cx(
				"sketch relative block w-full rounded-2xl px-4 pt-4 pb-3.5 text-left transition-colors duration-150 sm:px-5",
				!selected && "hover:bg-white",
			)}
			style={
				{
					"--sk-color": selected ? "var(--color-teal-deep)" : "var(--color-line)",
					"--sk-radius": "16px",
					background: selected ? "color-mix(in srgb, var(--color-mint) 52%, #fff)" : "var(--color-paper)",
				} as React.CSSProperties
			}
		>
			{/* the strip of tape that holds the one you chose to the wall */}
			{selected && (
				<span className="absolute -top-3 left-1/2 z-10 block w-[86px] -translate-x-1/2 -rotate-2 motion-safe:animate-[hl-pop_.3s_cubic-bezier(.16,1,.3,1)]">
					<span
						aria-hidden="true"
						className="torn-soft absolute inset-0 block rounded-[3px] bg-gold"
						style={{ boxShadow: "0 2px 5px rgba(28,26,89,.14)" }}
					/>
					<span className="label relative block py-[5px] text-center text-[0.58rem] tracking-[0.14em] text-navy">
						selected
					</span>
				</span>
			)}

			<span className="flex items-start gap-3.5">
				{/* the maker's photo on its own white ground, so it reads as a photo
            on the mint of a selected card as much as on the paper of the rest */}
				<PrinterPhoto
					id={goal.id}
					sizes="(min-width: 1024px) 88px, 76px"
					className="size-[76px] shrink-0 rounded-xl border border-line/80 lg:size-[88px]"
				/>

				<span className="min-w-0 flex-1">
					<span className="flex items-start gap-2">
						<span
							aria-hidden="true"
							className={cx(
								"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border-2 transition-colors",
								selected ? "border-transparent bg-teal-deep" : "border-line-strong",
							)}
						>
							{selected && <span className="size-[7px] rounded-full bg-white" />}
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-[1.02rem] leading-tight font-extrabold text-navy">{goal.name}</span>
							{current && <span className="hand mt-0.5 block text-[0.72rem] text-teal-ink">your goal right now</span>}
						</span>
						{goal.note && (
							<span
								className={cx(
									"label mt-px shrink-0 rounded-full px-2 py-1 text-[0.6rem]",
									goal.note === "Resin" ? "bg-gold-pale text-gold-ink" : "bg-coral/15 text-coral-dark",
								)}
							>
								{goal.note}
							</span>
						)}
					</span>

					<span className="mt-1.5 block text-[0.79rem] leading-snug text-navy-soft">{goal.blurb}</span>
				</span>
			</span>

			<span className="mt-3.5 block border-t border-dashed border-line/90 pt-3">
				<span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<span className="flex items-baseline gap-1.5">
						<IconCoin className="translate-y-0.5 text-[1.05rem] text-orange" />
						<span className="text-[1.05rem] leading-none font-extrabold tabular-nums text-navy">
							{goal.coins.toLocaleString()}
						</span>
					</span>
					<span className="ml-auto flex items-center gap-1.5 text-[0.79rem] font-semibold text-teal-ink">
						<IconClock className="text-[0.95rem]" />
						<span className="tabular-nums">{Math.round(goal.paceHours * 5)}</span> coins to earn/design wk
					</span>
				</span>

				{/* how steep the weekly commitment is, against the steepest on the board */}
				<span
					aria-hidden="true"
					className="relative mt-2 block h-[5px] w-full rounded-full"
					style={{ background: "rgba(28,26,89,.09)" }}
				>
					<span
						className="absolute inset-y-0 left-0 rounded-full bg-teal transition-[width] duration-500 ease-out"
						style={{ width: `${load}%` }}
					/>
				</span>
			</span>
		</button>
	)
}
