import type { ReactNode } from "react"
import { IconCheck } from "@/components/platform/icons"
import { Panel } from "@/components/platform/ui"
import { BOM_MARGIN_USD } from "@/lib/bom-policy"
import type { BomLine } from "@/lib/bom-schema"
import { TIERS } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { fmtHours } from "@/lib/numbers"
import { SUBMISSION_LIMIT } from "@/lib/resubmissions"
import { Acknowledgement } from "./checkpoint-shared"

/**
 * A blocker or warning above the step body.
 *
 * Every one of these is the same sketch box, icon, title and prose; only the colour and the words differ. Kept as one component so a change to the shape of a notice – the margin, the radius, the type – lands on all of them at once.
 */
export function SubmitNotice({
	children,
	icon,
	title,
	tone = "coral",
}: {
	children: ReactNode
	icon: ReactNode
	title: ReactNode
	/** `gold` is the softer notice: a resubmission that still has attempts left. */
	tone?: "coral" | "gold"
}) {
	const gold = tone === "gold"
	return (
		<div
			className={cx(
				"sketch mb-5 flex items-start gap-3 rounded-2xl px-5 py-4",
				gold ? "bg-gold-pale/70" : "bg-coral/10",
			)}
			style={{
				"--sk-color": gold ? "var(--color-gold-deep)" : "var(--color-coral)",
				"--sk-radius": "16px",
			}}
		>
			{icon}
			<div className="min-w-0">
				<p className={cx("text-[0.95rem] leading-snug font-extrabold", gold ? "text-navy" : "text-coral-dark")}>
					{title}
				</p>
				<div className="mt-1 text-[0.85rem] leading-snug text-navy-soft">{children}</div>
			</div>
		</div>
	)
}

/**
 * The project's parts list as it will be handed in, with the running total beneath it.
 *
 * Read-only here on purpose: the list is edited on the project page, so what the sheet shows is what the maker kept there when they opened it.
 */
export function BomTable({
	bom,
	bomError,
	bomTotal,
}: {
	bom: { items: BomLine[]; taxShippingUsd: number } | null
	bomError: string | null
	bomTotal: number
}) {
	return (
		<Panel className="overflow-hidden bg-white" radius={18} tone="line">
			{bomError ? (
				<p className="px-4 py-5 text-[0.86rem] font-semibold text-coral-deep" role="alert">
					{bomError}
				</p>
			) : !bom ? (
				<p aria-live="polite" className="hand px-4 py-5 text-[0.88rem] text-navy-soft">
					reading your parts list…
				</p>
			) : (
				<div className="overflow-x-auto">
					<table className="w-full min-w-120 text-left text-[0.86rem]">
						<thead>
							<tr className="border-b border-dashed border-line">
								{["Part", "Qty", "Unit", "Total", "Vendor"].map(h => (
									<th className="label px-4 py-2.5 text-navy-soft" key={h} scope="col">
										{h}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{bom.items.length === 0 && (
								<tr className="border-b border-dashed border-line/60">
									<td className="hand px-4 py-3.5 text-[0.88rem] text-coral-deep" colSpan={5}>
										no parts listed yet. Add them on the project page (or decline funding below) before you submit this.
									</td>
								</tr>
							)}
							{bom.items.map(l => (
								<tr className="border-b border-dashed border-line/60 align-top" key={l.id}>
									<td className="px-4 py-2.5">
										<span className="block font-semibold [overflow-wrap:anywhere] text-navy">{l.name}</span>
										{l.purpose && <span className="block text-[0.8rem] leading-snug text-navy-soft">{l.purpose}</span>}
									</td>
									<td className="px-4 py-2.5 tabular-nums">{l.quantity}</td>
									<td className="px-4 py-2.5 tabular-nums">${l.unitCostUsd.toFixed(2)}</td>
									<td className="px-4 py-2.5 font-semibold text-navy tabular-nums">
										${(l.quantity * l.unitCostUsd).toFixed(2)}
									</td>
									<td className="hand px-4 py-2.5 text-navy-soft">
										{l.link ? (
											<a
												className="underline decoration-line-strong underline-offset-4 hover:text-navy"
												href={l.link}
												rel="noopener noreferrer"
												target="_blank"
											>
												{l.vendor || "link"}
											</a>
										) : (
											l.vendor || "-"
										)}
									</td>
								</tr>
							))}
							<tr>
								<td className="px-4 py-2.5">
									<span className="block font-semibold text-navy">Tax &amp; shipping</span>
									<span className="block text-[0.8rem] leading-snug text-navy-soft">for the whole order</span>
								</td>
								<td className="px-4 py-2.5 text-navy-soft">-</td>
								<td className="px-4 py-2.5 text-navy-soft">-</td>
								<td className="px-4 py-2.5 font-semibold text-navy tabular-nums">${bom.taxShippingUsd.toFixed(2)}</td>
								<td />
							</tr>
						</tbody>
					</table>
				</div>
			)}
			<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-cream px-4 py-3">
				<span className="label text-navy-soft">Cart total</span>
				<span className="text-[1.05rem] font-extrabold text-navy tabular-nums">${bomTotal.toFixed(2)}</span>
			</div>
		</Panel>
	)
}

/** The checkboxes a maker clears before handing in, including the extra one a resubmission carries. */
export function SubmissionAcknowledgements({
	acknowledgedAll,
	acknowledgedFixed,
	acknowledgedLimit,
	acknowledgedNoMore,
	resubmitting,
	setAcknowledgedAll,
	setAcknowledgedFixed,
	setAcknowledgedLimit,
	setAcknowledgedNoMore,
}: {
	acknowledgedAll: boolean
	acknowledgedFixed: boolean
	acknowledgedLimit: boolean
	acknowledgedNoMore: boolean
	resubmitting: boolean
	setAcknowledgedAll(value: boolean): void
	setAcknowledgedFixed(value: boolean): void
	setAcknowledgedLimit(value: boolean): void
	setAcknowledgedNoMore(value: boolean): void
}) {
	return (
		<div className="mt-6 border-t border-dashed border-line pt-5">
			<p className="label text-violet-deep">{resubmitting ? "Before you resubmit" : "Before you submit"}</p>
			<p className="mt-1 text-[0.85rem] leading-snug text-navy-soft">
				All of these are required before you can submit.
			</p>
			<div className="mt-2.5 grid gap-1">
				<Acknowledgement checked={acknowledgedLimit} onChange={setAcknowledgedLimit}>
					I understand that I will only be able to submit this project {SUBMISSION_LIMIT} times
					{resubmitting ? "." : " in the event that it gets returned."}
				</Acknowledgement>
				<Acknowledgement checked={acknowledgedNoMore} onChange={setAcknowledgedNoMore}>
					I understand that if I run out of submissions, I cannot submit this phase again.
				</Acknowledgement>
				{resubmitting && (
					<Acknowledgement checked={acknowledgedFixed} onChange={setAcknowledgedFixed}>
						I have fixed everything the reviewer asked for in the note above.
					</Acknowledgement>
				)}
				<Acknowledgement checked={acknowledgedAll} onChange={setAcknowledgedAll}>
					I have checked the work above is mine, and that everything the reviewer needs to see is in the project or
					reels.
				</Acknowledgement>
			</div>
		</div>
	)
}

export function TierPicker({
	bomOverCap,
	bomTotal,
	funding,
	fundingDeclined,
	goal,
	hours,
	partialFunding,
	selectedTier,
	setAcceptsPartialFunding,
	setDeclinedFunding,
	setTier,
	tier,
	tierFloor,
	tierShort,
}: {
	bomOverCap: boolean
	bomTotal: number
	funding: { shortfallUsd: number; totalUsd: number }
	fundingDeclined: boolean
	goal: { name: string }
	hours: number
	partialFunding: boolean
	selectedTier: { grantUsd: number; name: string }
	setAcceptsPartialFunding(value: boolean): void
	setDeclinedFunding(value: boolean): void
	setTier(tier: 1 | 2 | 3): void
	tier: 1 | 2 | 3
	tierFloor(fundingHours: number): number
	tierShort(fundingHours: number): number
}) {
	return (
		<div className="mt-8 border-t border-dashed border-line pt-6">
			<p className="label mb-2 text-magenta">Finalise your tier</p>
			<p className="mb-3 text-[0.82rem] leading-snug text-navy-soft">
				Find out which tier you&apos;re eligible for! Your current goal is a{" "}
				<span className="font-bold text-navy">{goal.name}</span> and you have{" "}
				<span className="font-bold text-navy tabular-nums">{fmtHours(hours)}</span> logged this week.
			</p>
			<div className="grid gap-2.5 sm:grid-cols-3">
				{TIERS.map(t => {
					const on = tier === t.id
					const over = bomTotal > t.grantUsd
					const short = tierShort(t.fundingHours)
					return (
						<button
							aria-pressed={on}
							className={cx(
								"sketch rounded-2xl px-4 py-3 text-left transition-colors",
								short > 0
									? "cursor-not-allowed bg-black/[.03]"
									: on
										? "bg-violet-pale"
										: "bg-white hover:bg-black/[.03]",
							)}
							// A tier you have not worked the hours for is not an option, so it does not behave like one.
							disabled={short > 0}
							key={t.id}
							onClick={() => setTier(t.id)}
							style={{
								"--sk-color": on ? "var(--color-violet)" : "var(--color-line)",
								"--sk-radius": "16px",
							}}
							type="button"
						>
							<span className={cx("block text-[0.95rem] font-extrabold", short > 0 ? "text-navy-soft" : "text-navy")}>
								Tier {t.id}
							</span>
							<span className={cx("hand block text-[0.86rem]", short > 0 ? "text-navy-soft" : "text-teal-ink")}>
								{fundingDeclined ? "no parts grant" : `$${t.grantUsd} for parts`}
							</span>

							{/* The hours are the gate, so they lead. The cart only says whether the money fits inside the tier once the tier is actually available to you. */}
							<span
								className={cx(
									"mt-1 block text-[0.76rem] leading-snug",
									short > 0 ? "text-coral-deep" : "text-navy-soft",
								)}
							>
								{short > 0
									? `Opens at ${fmtHours(tierFloor(t.fundingHours))} of design time, ${fmtHours(short)} to go`
									: fundingDeclined
										? // No grant means no funded block: every logged hour pays, including the ones the tier's money would have bought.
											"Every logged hour earns 5 spendable coins"
										: `Every hour past this tier's ${t.fundingHours}h earns 5 spendable coins`}
							</span>
							{short === 0 && over && !fundingDeclined && (
								<span className="hand mt-1 block text-[0.74rem] leading-snug text-coral-deep">
									{bomTotal > t.grantUsd + BOM_MARGIN_USD
										? `Cart over by $${(bomTotal - t.grantUsd).toFixed(2)}, so only $${t.grantUsd} of it is funded and you have to agree to that below`
										: `Cart over by $${(bomTotal - t.grantUsd).toFixed(2)}, but within the $${BOM_MARGIN_USD} margin, so you can still submit`}
								</span>
							)}
						</button>
					)
				})}
			</div>

			{/* A cart past the tier's funding still hands in, as a grant that covers part of it – so the box saying so is a requirement rather than a note, and the shortfall is named in dollars rather than left to be found later. It sits under the tier picker because it is that choice it is about, and it disappears the moment a tier that covers the cart is picked. Declining makes the whole cart theirs, so there is no shortfall to agree to. */}
			{bomOverCap && !fundingDeclined && (
				<label
					className={cx(
						"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
						partialFunding ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
					)}
					style={{
						"--sk-color": partialFunding ? "var(--color-violet)" : "var(--color-line)",
						"--sk-radius": "16px",
					}}
				>
					<input
						checked={partialFunding}
						className="sr-only"
						onChange={e => {
							setAcceptsPartialFunding(e.target.checked)
							if (e.target.checked) setDeclinedFunding(false)
						}}
						type="checkbox"
					/>
					<span
						aria-hidden="true"
						className={cx(
							"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
							partialFunding ? "border-transparent bg-violet" : "border-line-strong",
						)}
					>
						{partialFunding && <IconCheck className="text-sm text-white" />}
					</span>
					<span className="min-w-0">
						<span className="block text-[0.95rem] font-extrabold text-navy">
							I understand this project gets partial funding
						</span>
						<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
							Your parts list is ${funding.totalUsd.toFixed(2)} and {selectedTier.name} funds ${selectedTier.grantUsd},
							so ${funding.shortfallUsd.toFixed(2)} of it is yours to pay. Tick this to hand the week in anyway. A
							reviewer can still move you up a tier, but that shortfall is yours unless they do.
						</span>
					</span>
				</label>
			)}
		</div>
	)
}
