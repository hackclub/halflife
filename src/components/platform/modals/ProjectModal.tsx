"use client"
import { useEffect, useState } from "react"
import { Gato, WeekPainting } from "@/components/platform/art"
import { IconArrowRight, IconCheck, IconWarning } from "@/components/platform/icons"
import { RepoInput, repoIsValid } from "@/components/platform/RepoField"
import { ProjectChoiceCard, StarterProjectCard } from "@/components/platform/StarterProjectCard"
import { Button, Chip, Field, inputClass, OptionRow, TextInput } from "@/components/platform/ui"
import { FREESTYLE_GUIDES, FREESTYLE_WEEK, isFreestyle } from "@/lib/config/freestyle"
import { STARTER_MODIFICATION_NOTE, STARTER_PROJECT_TIER, starterProjectsFor } from "@/lib/config/onboarding"
import { submitFloorFor } from "@/lib/config/printers"
import { THEMES } from "@/lib/config/program"
import { TIERS } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { fmtHours } from "@/lib/numbers"
import { validateRepoField } from "@/lib/repo"
import { usePrinterPace, useStore, weekListPhrase } from "@/lib/store"
import type { Checkpoint } from "@/lib/types"
import { Modal, ModalTitle } from "./Modal"

/* ================================================================== *
 * Project creation (weeks 2-5, and week 1 once its project is deleted)
 * ================================================================== */
export function ProjectModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const { setOpenCheckpoint, complete, addProject, ensureProject, experience, weekOf, projects } = useStore()
	const week = weekOf(checkpoint.weekId)
	const pace = usePrinterPace()
	// Opening "create a project" is what makes the week's project row – not signing up, when nobody knows yet whether they will get this far.
	useEffect(() => {
		void ensureProject(checkpoint.weekId)
	}, [checkpoint.weekId, ensureProject])
	// Set when an admin redoes a finished form: it starts from what the project already says rather than from blank.
	const existing = projects.find(p => p.weekId === checkpoint.weekId)
	const [name, setName] = useState(existing?.name ?? "")
	const [desc, setDesc] = useState(existing?.description ?? "")
	const [tier, setTier] = useState<1 | 2 | 3>(
		existing?.tier ?? (experience === "lots" ? 3 : experience === "some" ? 2 : 1),
	)
	const [repo, setRepo] = useState(existing?.githubRepo ?? "")
	// The week's starter projects, for someone who said they are new to hardware. Weeks follow the theme order, design then build, so the week number names the theme.
	const theme = THEMES[(week.id - 1) % THEMES.length]?.id
	const starters = theme && (experience === "first" || experience === "little") ? starterProjectsFor(theme) : []
	// Taking one fills the form in and holds the tier at 1, as onboarding does.
	const [starterId, setStarterId] = useState<string | null>(existing?.starterProjectId ?? null)
	const [pick, setPick] = useState<string | null | undefined>(
		existing ? (existing.starterProjectId ?? null) : undefined,
	)
	// Freestyle week opens on its own page first, except when an admin redoes a form that was already filled in.
	const freestyle = week.id === FREESTYLE_WEEK && isFreestyle()
	const firstStage = starters.length > 0 ? "choose" : "details"
	const [stage, setStage] = useState<"intro" | "choose" | "details">(
		freestyle && !existing?.name ? "intro" : firstStage,
	)
	const backStage = starters.length > 0 ? "choose" : freestyle ? "intro" : null
	const takeStarter = (s: (typeof starters)[number]) => {
		setPick(s.id)
	}
	const chooseCustom = () => {
		setPick(null)
	}
	const advance = () => {
		if (pick === undefined) return
		if (pick === null) setStarterId(null)
		else {
			const s = starters.find(x => x.id === pick)
			setStarterId(pick)
			if (s) setName(s.title)
			setTier(STARTER_PROJECT_TIER)
		}
		setStage("details")
	}

	const ok = name.trim().length > 1 && desc.trim().length > 4 && repoIsValid(repo)
	const selectedStarter = starterId === null ? undefined : starters.find(s => s.id === starterId)

	return (
		<Modal
			accent={week.accent}
			eyebrow={`Week ${week.id} · ${week.fullName}`}
			footer={
				<>
					{stage === "intro" && (
						<Button onClick={() => setStage(firstStage)} variant="solid">
							Make my project <IconArrowRight className="text-base" />
						</Button>
					)}
					{stage === "details" && backStage && (
						<Button className="mr-auto" onClick={() => setStage(backStage)} type="button" variant="outline">
							Back
						</Button>
					)}
					{stage === "choose" && starters.length > 0 && (
						<Button disabled={pick === undefined} onClick={advance} variant="solid">
							Next <IconArrowRight className="text-base" />
						</Button>
					)}
					{stage === "details" && (
						<Button
							disabled={!ok}
							onClick={() => {
								addProject({
									buildStatus: "draft",
									description: desc.trim(),
									designStatus: "draft",
									githubRepo: validateRepoField(repo).url,
									name: name.trim(),
									starter: starterId !== null,
									starterProjectId: starterId,
									tier,
									weekId: week.id,
								})
								complete(checkpoint.id, { artefacts: 1 })
								setOpenCheckpoint(null)
							}}
							variant="solid"
						>
							Create project <IconArrowRight className="text-base" />
						</Button>
					)}
				</>
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			size="lg"
		>
			{stage === "intro" ? (
				<ModalTitle>Week 5: Freestyle!</ModalTitle>
			) : (
				<ModalTitle sub={week.summary}>{week.headline}</ModalTitle>
			)}

			{/* Starting a week with weeks already behind you is when the printer's fine print matters, and about the last moment it is any use: the coins being paced toward come from approved weeks, and some of those have gone. Only somebody saving for a machine hears it – a funding-only maker has no prize to fall short of. */}
			{pace.printer && pace.missedWeeks.length > 0 && (
				<div
					className="sketch mb-5 flex items-start gap-3 rounded-2xl bg-coral/10 px-5 py-4"
					style={{ "--sk-color": "var(--color-coral)", "--sk-radius": "16px" }}
				>
					<IconWarning className="mt-0.5 shrink-0 text-xl text-coral-deep" />
					<div className="min-w-0">
						<p className="text-[0.95rem] leading-snug font-extrabold text-coral-dark">
							You&apos;re behind on your printer goal.
						</p>
						<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
							{weekListPhrase(pace.missedWeeks)} passed without being approved, and coins only come from an approved
							week. A <span className="font-bold text-navy">{pace.printer.name}</span> asks about{" "}
							<span className="font-bold text-navy tabular-nums">{pace.perWeekCoins}</span> coins every design week, so
							you may not be eligible for it, because the bigger prizes need all 5 themes finished. A bigger week later
							can make some of it up.
						</p>
					</div>
				</div>
			)}

			{stage === "intro" ? (
				<FreestyleIntro />
			) : stage === "choose" ? (
				<div className="grid gap-3 sm:grid-cols-2">
					{starters.length > 0 && <p className="col-span-full label mb-2 text-left text-violet-deep">Step 1 / 2</p>}
					{starters.map(s => (
						<StarterProjectCard
							action={
								<Button
									aria-pressed={pick === s.id}
									onClick={() => takeStarter(s)}
									size="sm"
									type="button"
									variant={pick === s.id ? "teal" : "outline"}
								>
									Use starter project
									{pick === s.id ? <IconCheck className="text-base" /> : null}
								</Button>
							}
							chosen={pick === s.id}
							key={s.id}
							stacked
							starter={s}
						/>
					))}
					<ProjectChoiceCard
						action={
							<Button
								aria-pressed={pick === null}
								onClick={chooseCustom}
								size="sm"
								type="button"
								variant={pick === null ? "teal" : "outline"}
							>
								Make a custom project
								{pick === null ? <IconCheck className="text-base" /> : null}
							</Button>
						}
						art={<Gato className="h-35 w-auto" pose="schematic" sizes="260px" />}
						chosen={pick === null}
						label="Custom project"
						stacked
						tileClassName="bg-violet-pale"
						title="Your own idea"
					>
						<p className="mt-1.5 text-[0.88rem] leading-relaxed text-navy-soft">
							Make your own project! It can be anything you want within this week&rsquo;s theme: {week.fullName}.
						</p>
					</ProjectChoiceCard>
					{/* Only once a starter is the pick: it is a rule about the choice, not about the step, and beside "make your own" it read as a warning about the whole fork. */}
					{typeof pick === "string" && (
						<div className="mt-3 rounded-2xl border-2 border-dashed border-gold-deep/40 bg-gold-pale/50 px-4 py-3 text-[0.86rem] leading-relaxed text-navy-soft sm:col-span-2">
							{STARTER_MODIFICATION_NOTE}
						</div>
					)}
				</div>
			) : (
				<div className="grid gap-6 lg:grid-cols-[1fr_230px] lg:items-start">
					<div className="grid gap-4">
						{starters.length > 0 && <p className="label mb-2 text-left text-violet-deep">Step 2 / 2</p>}
						<p className="hand mb-2 text-left text-[0.8rem] text-navy-soft">
							Tier can be changed any time before you submit this week.
						</p>
						{starterId !== null && (
							<div className="flex flex-wrap items-center gap-x-4 gap-y-2">
								<Chip tone="teal">
									<IconCheck className="text-[0.9rem]" /> Building {selectedStarter?.title ?? "starter"}
								</Chip>
								<button
									className="hand text-[0.82rem] text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
									onClick={() => setStage("choose")}
									type="button"
								>
									Choose a different starting point
								</button>
							</div>
						)}
						<Field hint="Give it a cool name." id="np-name" label="Project name">
							<TextInput
								id="np-name"
								onChange={e => setName(e.target.value)}
								placeholder={`My ${week.theme.toLowerCase()} project`}
								value={name}
							/>
						</Field>
						<Field hint="What's it gonna do?" id="np-desc" label="Project description">
							<textarea
								className={cx(inputClass, "resize-none")}
								id="np-desc"
								onChange={e => setDesc(e.target.value)}
								placeholder={selectedStarter ? selectedStarter.description : "A few sentences on what it does and how."}
								rows={3}
								value={desc}
							/>
						</Field>
						<RepoInput id="np-repo" onChange={setRepo} value={repo} />

						<div className="mt-2">
							<p className="label mb-2 text-violet-deep">Funding tier</p>
							{starterId !== null && (
								<p className="hand mb-2.5 text-[0.82rem] text-navy-soft">
									Starter projects are Tier 1. Switch to your own idea to choose a different tier.
								</p>
							)}
							{/* The hours quoted here are the funded block, which is exactly what the submit gate holds you to. The funded hours buy the parts; every hour past them earns spendable coins. */}
							<div className="grid gap-2.5">
								{TIERS.map(t => (
									<OptionRow
										disabled={starterId !== null && t.id !== STARTER_PROJECT_TIER}
										hint={
											<span className="text-navy-soft/90">
												You can submit on tier {t.id} from {fmtHours(t.fundingHours)} of design time, the parts-funding
												hours and nothing more. Every hour past that (once your tier&apos;s funding is achieved) earns 5
												spendable coins.
											</span>
										}
										key={t.id}
										onClick={() => setTier(t.id)}
										selected={tier === t.id}
									>
										<span className="flex flex-wrap items-baseline gap-x-2.5">
											<span className="text-[0.98rem] font-extrabold text-navy">Tier {t.id}</span>
											<span className="hand text-[0.86rem] text-teal-ink">${t.grantUsd} for parts</span>
											<span className="hand text-[0.8rem] text-navy-soft">
												· {fmtHours(submitFloorFor(t.fundingHours))} to submit
											</span>
										</span>
									</OptionRow>
								))}
							</div>
						</div>
					</div>

					<div className="order-first lg:order-none">
						<div className="overflow-hidden rounded-2xl p-4" style={{ background: week.accent }}>
							<WeekPainting
								className="sticker-shadow mx-auto aspect-square w-full max-w-55"
								sizes="(min-width: 1024px) 198px, 220px"
								theme={week.theme}
							/>
						</div>
						<p className="mt-3 text-[0.86rem] leading-snug text-navy-soft">{week.primer.split(". ")[0]}.</p>
					</div>
				</div>
			)}
		</Modal>
	)
}

/** Freestyle week's first page: no theme this week, some guides for finding an idea, and a push for the last design week. */
function FreestyleIntro(): React.JSX.Element {
	return (
		<div className="grid gap-5">
			<p className="max-w-[62ch] text-[0.95rem] leading-relaxed text-navy-soft">
				This week, we&apos;ve decided to give Half Lifers <em className="font-bold text-navy">complete control</em> over
				their project. If you still want to make a breadboard computer this week, go ahead! But you&apos;re not
				restricted to. Half Life is all about getting more teenagers to become hardware experts, and building your own
				custom project is the first step. But if you&apos;re still hesitant, don&apos;t worry, we have some guides that
				you can use to come up with your next project.
			</p>

			{/* Always open, two by two at every width: four short names fit a phone's two columns, and wrap rather than truncate when they do not. */}
			<ul aria-label="Project guides" className="grid grid-cols-2 gap-2">
				{FREESTYLE_GUIDES.map(g => (
					<li className="flex" key={g.url}>
						<a
							className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 border-line bg-white px-4 py-3 text-[0.92rem] leading-snug font-bold text-navy transition-colors hover:border-violet hover:bg-violet-pale"
							href={g.url}
							rel="noopener noreferrer"
							target="_blank"
						>
							{g.title}
							<span className="sr-only"> (opens in a new tab)</span>
							<IconArrowRight aria-hidden="true" className="shrink-0 text-base text-violet-deep" />
						</a>
					</li>
				))}
			</ul>

			<div
				className="sketch grid gap-1 rounded-2xl bg-gold px-5 py-6 text-center"
				style={{ "--sk-color": "var(--color-gold-deep)", "--sk-radius": "16px" }}
			>
				<p className="text-[1.6rem] leading-tight font-extrabold tracking-[-0.02em] text-navy sm:text-[2.1rem]">
					IT&apos;S THE LAST DESIGN WEEK!
				</p>
				<p className="text-[1.25rem] leading-tight font-extrabold text-navy sm:text-[1.5rem]">YOU GOT THIS!</p>
			</div>
		</div>
	)
}
