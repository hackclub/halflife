"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { WeekPainting } from "@/components/platform/art"
import { IconArrowRight } from "@/components/platform/icons"
import { RepoInput, repoIsValid } from "@/components/platform/RepoField"
import { Button, Field, inputClass, OptionRow } from "@/components/platform/ui"
import { submitFloorFor } from "@/lib/config/printers"
import { WARMUP_THEME } from "@/lib/config/program"
import { BUILD_HOURS, TIERS } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { fmtHours } from "@/lib/numbers"
import { validateRepoField } from "@/lib/repo"
import { Modal, ModalTitle } from "./Modal"

/**
 * Start a warm-up project: the season's "create a project" sheet, for any hardware idea rather than a theme, plus the one question a warm-up adds – whether it is handed in as a design or as a finished build. It is handed in once, as that.
 */
export function WarmupModal({ onClose, closesOn }: { onClose(): void; closesOn: string | null }) {
	const router = useRouter()
	const [name, setName] = useState("")
	const [desc, setDesc] = useState("")
	const [repo, setRepo] = useState("")
	const [phase, setPhase] = useState<"DESIGN" | "BUILD" | null>(null)
	const [tier, setTier] = useState<1 | 2 | 3>(1)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const ok = name.trim().length > 1 && desc.trim().length > 4 && repoIsValid(repo) && phase !== null

	async function create() {
		if (!ok || !phase) return
		setSaving(true)
		setError(null)
		try {
			const res = await fetch("/api/projects/warmup", {
				body: JSON.stringify({
					description: desc.trim(),
					githubRepo: validateRepoField(repo).url,
					phase,
					requestedTier: tier,
					title: name.trim(),
				}),
				headers: { "content-type": "application/json" },
				method: "POST",
			})
			const payload = (await res.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null
			if (!res.ok || !payload?.id) {
				setError(payload?.error?.message ?? `The project was not created (${res.status}). Try again.`)
				return
			}
			router.push(`/projects/${payload.id}`)
			router.refresh()
			onClose()
		} catch {
			setError("Could not reach the server. Nothing was created – try again.")
		} finally {
			setSaving(false)
		}
	}

	return (
		<Modal
			accent="var(--color-violet)"
			eyebrow="Warm-up project"
			footer={
				<>
					{error ? (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
							{error}
						</p>
					) : (
						<p className="hand mr-auto hidden text-[0.78rem] text-navy-soft sm:block">
							Tier can be changed any time before you submit.
						</p>
					)}
					<Button disabled={saving} onClick={onClose} variant="outline">
						Cancel
					</Button>
					<Button disabled={!ok || saving} onClick={() => create()} variant="solid">
						{saving ? "Creating…" : "Create project"} <IconArrowRight className="text-base" />
					</Button>
				</>
			}
			onClose={onClose}
			open
			size="lg"
		>
			<ModalTitle
				sub={
					closesOn
						? `Any hardware project you like, no theme. Journal it and submit it like every Half Life project. Warm-ups close ${closesOn}.`
						: "Any hardware project you like, no theme. Journal it and submit it like every Half Life project."
				}
			>
				Start a warm-up project
			</ModalTitle>

			<div className="grid gap-6 lg:grid-cols-[1fr_230px] lg:items-start">
				<div className="grid gap-4">
					<Field hint="Give it a cool name." id="wu-name" label="Project name">
						<input
							className={inputClass}
							id="wu-name"
							maxLength={120}
							onChange={e => setName(e.target.value)}
							placeholder="My warm-up project"
							value={name}
						/>
					</Field>
					<Field hint="What it does, and what makes it yours." id="wu-desc" label="Project description">
						<textarea
							className={cx(inputClass, "resize-none")}
							id="wu-desc"
							maxLength={4000}
							onChange={e => setDesc(e.target.value)}
							placeholder="A macropad with a rotary encoder for my editing shortcuts"
							rows={3}
							value={desc}
						/>
					</Field>
					<RepoInput id="wu-repo" onChange={setRepo} value={repo} />

					<fieldset className="mt-2 grid gap-2.5">
						<legend className="label mb-2 text-violet-deep">What will you submit?</legend>
						<OptionRow
							hint="Design it and submit it with a parts list to get it funded."
							onClick={() => setPhase("DESIGN")}
							selected={phase === "DESIGN"}
						>
							<span className="text-[0.98rem] font-extrabold text-navy">A design</span>
						</OptionRow>
						<OptionRow
							hint="You already have the parts. Build it and submit a demo of it working."
							onClick={() => setPhase("BUILD")}
							selected={phase === "BUILD"}
						>
							<span className="text-[0.98rem] font-extrabold text-navy">A finished build</span>
						</OptionRow>
					</fieldset>

					<fieldset className="mt-2 grid gap-2.5">
						<legend className="label mb-2 text-violet-deep">Funding tier</legend>
						{TIERS.map(t => (
							<OptionRow
								hint={
									<>
										{t.detail}
										{phase !== "BUILD" && (
											<span className="mt-1 block text-navy-soft/90">
												You can submit on tier {t.id} from {fmtHours(submitFloorFor(t.fundingHours))} of design time –
												every hour past that (once your tier&apos;s funding is achieved) earns 5 spendable coins.
											</span>
										)}
									</>
								}
								key={t.id}
								onClick={() => setTier(t.id)}
								selected={tier === t.id}
							>
								<span className="flex flex-wrap items-baseline gap-x-2.5">
									<span className="text-[0.98rem] font-extrabold text-navy">Tier {t.id}</span>
									<span className="hand text-[0.86rem] text-teal-ink">${t.grantUsd} for parts</span>
									<span className="hand text-[0.8rem] text-navy-soft">
										· {phase === "BUILD" ? BUILD_HOURS : submitFloorFor(t.fundingHours)}h to submit
									</span>
								</span>
							</OptionRow>
						))}
					</fieldset>
				</div>

				<div className="order-first lg:order-none">
					<div className="overflow-hidden rounded-2xl bg-violet-pale p-4">
						<WeekPainting
							alt=""
							className="mx-auto aspect-square w-full max-w-55"
							sizes="(min-width: 1024px) 198px, 220px"
							theme={WARMUP_THEME.label}
						/>
					</div>
					<p className="mt-3 text-[0.86rem] leading-snug text-navy-soft">
						Each warm-up is one submission: a design or a finished build, whichever you choose here. You can start as
						many as you like.
					</p>
				</div>
			</div>
		</Modal>
	)
}
