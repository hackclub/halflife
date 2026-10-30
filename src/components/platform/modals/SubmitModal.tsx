"use client"

import Link from "next/link"
import { type ReactNode, useEffect, useMemo, useState } from "react"
import {
	IconArrowRight,
	IconCamera,
	IconCart,
	IconCheck,
	IconFilm,
	IconPencil,
	IconWarning,
} from "@/components/platform/icons"
import { ReelCapture } from "@/components/platform/reels/ReelCapture"
import { Button, Chip, Field, inputClass, OptionRow, Panel } from "@/components/platform/ui"
import { errorMessage, refusalMessage } from "@/lib/api-error"
import { BOM_MARGIN_USD, bomTotalUsd, partsFunding } from "@/lib/bom-policy"
import type { BomLine } from "@/lib/bom-schema"
import { usesStarterDefaultDescription } from "@/lib/config/onboarding"
import { paceTarget, printerById, submitFloorFor } from "@/lib/config/printers"
import { MIN_PROJECT_DESCRIPTION_CHARS, WARMUP_WEEK_ID } from "@/lib/config/program"
import { ENTRY_TIER, getTier } from "@/lib/config/tiers"
import { TIERS } from "@/lib/curriculum"
import { cx } from "@/lib/cx"
import { fmtHours } from "@/lib/numbers"
import type { RepoCheckResult } from "@/lib/repo-checks"
import { SUBMISSION_LIMIT } from "@/lib/resubmissions"
import { useStore } from "@/lib/store"
import type { Checkpoint } from "@/lib/types"
import { Acknowledgement, BomResponseSchema, isWeeksProject, weekName } from "./checkpoint-shared"
import { ImageUploads, type UploadedImage } from "./ImageUploads"
import { Modal, ModalTitle } from "./Modal"
import { RepoChecks } from "./RepoChecks"
import { type SubmissionReel, SubmissionReelPicker } from "./SubmissionReelPicker"

/**
 * A blocker or warning above the step body.
 *
 * Every one of these is the same sketch box, icon, title and prose; only the colour and the words differ. Kept as one component so a change to the shape of a notice – the margin, the radius, the type – lands on all of them at once.
 */
function SubmitNotice({
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
function BomTable({
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
function SubmissionAcknowledgements({
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
					I understand that after using up my {SUBMISSION_LIMIT} submissions, I will not be able to resubmit this
					project.
				</Acknowledgement>
				{resubmitting && (
					<Acknowledgement checked={acknowledgedFixed} onChange={setAcknowledgedFixed}>
						I have fixed all issues mentioned in my project&rsquo;s &ldquo;needs changes&rdquo; note.
					</Acknowledgement>
				)}
				<Acknowledgement checked={acknowledgedAll} onChange={setAcknowledgedAll}>
					I understand and have abided by all of the above {resubmitting ? "3" : "2"} checkboxes.
				</Acknowledgement>
			</div>
		</div>
	)
}

export function SubmitModal({ checkpoint }: { checkpoint: Checkpoint }) {
	const {
		setOpenCheckpoint,
		submitPhase,
		postReel,
		projects,
		setProjectTier,
		weekOfCheckpoint,
		hoursOf,
		printerFund,
		pendingCoins,
		goalId,
		setSharePost,
		statusOf,
	} = useStore()
	const week = weekOfCheckpoint(checkpoint)
	const isBuild = week.phase === "build"

	// The week is long enough to hand in – that gate is the trail's, and this node would be locked otherwise. What is left to say is whether it was long enough for the machine actually on the wall. A surplus earned in an earlier week pays for a thin one, so this reads the running total against the pace rather than this week against its target.
	//
	// The running total is the fund plus what unreviewed weeks will earn. Coins are minted at approval, so the fund alone reads this very week – the one being handed in, which nobody can have reviewed yet – as earning nothing, and warned everyone on every submit.
	const goal = printerById(goalId)
	const owed = Math.max(0, Math.ceil(paceTarget(goal, week.id) - printerFund - pendingCoins(week.id)))

	// The fallback is for a season sheet opened before its project row landed; it must never pick the warm-up project, which has no season week.
	const project =
		projects.find(p => isWeeksProject(week, p)) ?? projects.find(p => p.weekId !== WARMUP_WEEK_ID) ?? projects[0]
	// Handing a returned phase in again is a resubmission, and the budget rides on the project from the store. It is said here before the sheet is filled in, because the server refuses it either way and a maker deserves to know at the start rather than at the button.
	const resubmitting = statusOf(week) === "update_requested"
	const submissionsUsed = project?.submissions?.[week.phase] ?? 0
	const submissionsLeft = Math.max(0, SUBMISSION_LIMIT - submissionsUsed)
	const outOfSubmissions = resubmitting && submissionsLeft === 0

	const [step, setStep] = useState(1)
	// R2 object keys, not flags: what these ask for is evidence, and a boolean was letting the form take a file and drop it on the floor. Several screenshots, because one order is often split across vendors and one checkout page is not always one screen tall.
	const [carts, setCarts] = useState<UploadedImage[]>([])
	const [tier, setTier] = useState<1 | 2 | 3>(project?.tier ?? 1)
	// Makers who want nothing from the parts fund can hand in an empty BOM: the box states it, a confirm makes sure, and the flag is what lets the sheet past step 2 without carts.
	const [declinedFunding, setDeclinedFunding] = useState(false)
	// A cart past the tier's funding: the maker ticks this to say they will cover the shortfall themselves. Held in local state like the decline above, because it is a statement about this hand-in and the server re-reads the numbers before it believes it.
	const [acceptsPartialFunding, setAcceptsPartialFunding] = useState(false)
	// A Displays project can have no microcontroller, and so no firmware to hand in. This is the maker's confirmation of that; the server honours it only when firmware is the one check missing.
	const [noMicrocontroller, setNoMicrocontroller] = useState(false)
	const [clip, setClip] = useState<string | null>(null)
	// The bucket URL of the closing clip, when there is one, so it can be saved and posted elsewhere afterwards.
	const [clipUrl, setClipUrl] = useState<string | null>(null)
	// A blob URL for a locally picked clip holds the whole video in memory until it is revoked – the preview is replaced or the sheet closes, not before.
	useEffect(
		() => () => {
			if (clipUrl?.startsWith("blob:")) URL.revokeObjectURL(clipUrl)
		},
		[clipUrl],
	)
	// The closing reel once it is posted. A hand-in that fails after the reel went up reuses it on the retry rather than posting the same clip twice; a new clip clears it.
	const [closingPostId, setClosingPostId] = useState<string | null>(null)

	/**
	 * Stand in a closing reel from an earlier hand-in of this same week, picked back rather than filmed again.
	 *
	 * It fills the clip slot so the sheet's own gate is satisfied, and `closingPostId` is what keeps `submit` from posting it a second time – the reel the reviewer already has is the one this hand-in closes with.
	 */
	function reuseClosingReel(reel: SubmissionReel | null) {
		setClip(reel?.objectKey ?? null)
		setClipUrl(reel?.videoUrl ?? null)
		setClosingPostId(reel?.id ?? null)
	}
	// Handed in: the reel that closed the week is offered for posting online.
	const [works, setWorks] = useState<"yes" | "no" | null>(null)
	const [writeup, setWriteup] = useState("")
	// Null while checking. The server runs the same checks at submit, so this only decides whether the sheet lets you get that far.
	const [repoResult, setRepoResult] = useState<RepoCheckResult | null>(null)
	const [submitting, setSubmitting] = useState(false)
	const [submitError, setSubmitError] = useState<string | null>(null)
	// The acknowledgements a maker makes before handing a phase in. The reviewer-note one only exists when a review has sent the phase back; the limit ones apply to every submission, the first included.
	const [acknowledgedLimit, setAcknowledgedLimit] = useState(false)
	const [acknowledgedNoMore, setAcknowledgedNoMore] = useState(false)
	const [acknowledgedFixed, setAcknowledgedFixed] = useState(false)
	const [acknowledgedAll, setAcknowledgedAll] = useState(false)
	const acknowledgementsComplete =
		acknowledgedLimit && acknowledgedNoMore && acknowledgedAll && (!resubmitting || acknowledgedFixed)

	// The closing reel is a reel like any other and goes on the trail under its own key, so the week's timeline shows it where it happened rather than swallowing it inside the submission.
	const reelCheckpointId = week.projectId ? `wu-${week.projectId}-reel-submission` : `w${week.id}-reel-submission`
	const closingSubject =
		week.id === WARMUP_WEEK_ID ? `Warm-up: ${project?.name ?? "my project"}` : `Week ${week.id}: ${week.theme}`
	const closingCaption = `${closingSubject} ${isBuild ? "built" : "designed"}.`
	const buildNotes = works === "no" && writeup.trim() ? writeup.trim() : undefined

	const total = isBuild ? 2 : 3
	// The project's own parts list, as kept on its page – read fresh when the sheet opens, because it is edited there and this is the moment it is handed in. Null while it loads; the cart total reads zero until then.
	const [bom, setBom] = useState<{ items: BomLine[]; taxShippingUsd: number } | null>(null)
	const [bomError, setBomError] = useState<string | null>(null)
	useEffect(() => {
		if (isBuild || !project) return
		let live = true
		void (async () => {
			try {
				const res = await fetch(`/api/projects/${project.id}/bom`, { cache: "no-store" })
				const payload: unknown = await res.json().catch(() => null)
				if (!res.ok) throw new Error(errorMessage(payload, refusalMessage(res.status, "Could not load the parts list")))
				const parsed = BomResponseSchema.safeParse(payload)
				if (!parsed.success) throw new Error("The parts list came back unreadable. Try again.")
				if (live) setBom({ items: parsed.data.items, taxShippingUsd: parsed.data.taxShippingUsd })
			} catch (err) {
				if (live) setBomError(err instanceof Error ? err.message : String(err))
			}
		})()
		return () => {
			live = false
		}
	}, [isBuild, project?.id]) // the id is the input
	// The same arithmetic the submit gate reads (lib/bom-policy), so the total on screen is the total being held to.
	const bomTotal = useMemo(() => bomTotalUsd(bom?.items ?? [], bom?.taxShippingUsd), [bom])

	/**
	 * A tier is a claim about hours as much as about money: its funded block has to be covered, and everything past it earns. Tier 2 funds thirteen hours, so thirteen hours pay for the project and the fourteenth already earns – which is why the tier cannot be raised at the last moment on hours that were only ever enough for a smaller one.
	 *
	 * Two asks come out of that, and they are different numbers. The floor is the funded block, and below it the week cannot be handed in at all, so it is a gate. The target is this maker's own goal, and it moves when they change what they are saving for – a P1S asks far more of a tier 2 week than an Ender does. Missing the target is a warning the sheet already gives; missing the floor is a refusal.
	 */
	const hours = hoursOf(week)
	const tierFloor = submitFloorFor
	const tierShort = (fundingHours: number) => Math.max(0, tierFloor(fundingHours) - hours)
	const selectedTier = getTier(tier) ?? ENTRY_TIER
	const tierBlocked = !isBuild && tierShort(selectedTier.fundingHours) > 0
	// Over the tier's funding warns; past the leeway the grant covers only part of the cart, which is allowed but has to be agreed to rather than discovered at review.
	const funding = partsFunding(bomTotal, selectedTier.grantUsd)
	const bomOverCap = !isBuild && funding.needsAgreement
	// No BOM, no carts, no order: declining funding is how an empty parts list hands in. Read off the loaded list every render rather than trusted from the toggle alone, so a stale flag can never unblock a week whose parts arrived after the box was ticked.
	const bomEmpty = !isBuild && bom !== null && bom.items.length === 0
	// Declining is a stated preference, not a reading of the list: it holds with parts or without, and only while the list has loaded – unticked until the box is actually on screen.
	const fundingDeclined = !isBuild && declinedFunding && bom !== null
	// Same reading for the partial-funding box: honoured only while the cart is actually over, so raising the tier or editing the parts list back under it retires the tick on its own. Declining wins over agreeing: no funding means nothing to agree to.
	const partialFunding = bomOverCap && acceptsPartialFunding && !fundingDeclined
	// The gate needs the agreement only when there is something to agree to: under budget there is nothing, and declined means no grant at all.
	const fundingOk = fundingDeclined || !bomOverCap || acceptsPartialFunding

	// The Displays week requires firmware, but a project with no microcontroller has none to give. That check is waivable only when it is the one thing missing; every other blocking failure still holds the sheet.
	const firmwareMissing =
		week.theme === "Displays"
		&& (repoResult?.checks.some(check => check.key === "firmware" && check.blocking && check.status === "fail")
			?? false)
	const otherRepoBlocker =
		repoResult?.checks.some(check => check.blocking && check.status === "fail" && check.key !== "firmware") ?? false
	const repoReady = (repoResult?.canSubmit ?? false) || (firmwareMissing && !otherRepoBlocker && noMicrocontroller)

	const hasCover = Boolean(project?.coverImageKey)
	const descriptionLength = project?.description.trim().length ?? 0
	const descriptionReady = descriptionLength >= MIN_PROJECT_DESCRIPTION_CHARS
	const descriptionBlocker = `Write at least ${MIN_PROJECT_DESCRIPTION_CHARS} characters about your project before submitting. You have ${descriptionLength}.`
	// A starter's description is written into the project when it is taken. The server refuses it; the sheet says so before the button is pressed, so the maker fixes it where the field is.
	const starterDescriptionReady = !usesStarterDefaultDescription(
		project?.starterProjectId ?? null,
		project?.description ?? null,
	)
	const starterDescriptionBlocker =
		"Replace the starter project's default description with your own. Say what you changed, why you made it, and what makes it yours."

	const canAdvance =
		step === 1
			? repoReady
			: isBuild
				? clip
					&& descriptionReady
					&& starterDescriptionReady
					&& !outOfSubmissions
					&& acknowledgementsComplete
					&& (works === "yes" || (works === "no" && writeup.trim().length >= 40))
				: step === 2
					? // No funding, no order, no carts to screenshot: a declined empty BOM carries no cart evidence.
						(carts.length > 0 || fundingDeclined) && !tierBlocked && fundingOk
					: clip
						&& !tierBlocked
						&& fundingOk
						&& hasCover
						&& descriptionReady
						&& starterDescriptionReady
						&& !outOfSubmissions
						&& acknowledgementsComplete

	/**
	 * Why the button at the foot is greyed, in the maker's terms, or null when it is live.
	 *
	 * The button has always been disabled for exactly these reasons; what it never did was say which one was in the way, so a maker missing a cart screenshot met a dead Next with nothing on screen to explain it. The branches mirror `canAdvance` above step for step – a line here while the button is live would be worse than the silence it replaced.
	 *
	 * Step 1 keeps its own pair of lines at the foot: the repo check has a "still running" state the others do not. The cover banner at the top of the body is repeated here on purpose – it is a long scroll away from the button it blocks.
	 */
	function nextBlocker(): string | null {
		if (step === 1) return null
		if (outOfSubmissions)
			return `All ${SUBMISSION_LIMIT} submissions for this phase are used. Dispute the review or ask a reviewer in Slack.`
		if (step === total && !acknowledgementsComplete) return "Tick every acknowledgement above before submitting."
		// These two block whichever of the later steps is showing.
		if (tierBlocked)
			return `Your tier needs ${fmtHours(tierShort(selectedTier.fundingHours))} more design time than you have logged this week. Pick a tier you have earned.`
		if (!fundingOk) return "Tick the box agreeing to cover the part of the cart the grant does not."
		if (isBuild)
			return !clip
				? "Record your demo video to carry on."
				: works === "no" && writeup.trim().length < 40
					? "Say what needs to change in a sentence or two."
					: !descriptionReady
						? descriptionBlocker
						: !starterDescriptionReady
							? starterDescriptionBlocker
							: null
		if (step === 2)
			return carts.length === 0 && !fundingDeclined ? "Add a screenshot of your cart above to carry on." : null
		if (!clip) return "Record your closing reel to carry on."
		if (!hasCover) return "Add a cover image to your project before you can submit."
		if (!descriptionReady) return descriptionBlocker
		if (!starterDescriptionReady) return starterDescriptionBlocker
		return null
	}

	/**
	 * Handing a week in, in the order the pieces depend on each other.
	 *
	 * The tier first, because it is what the reviewer will be deciding against. Then the closing reel, awaited, so the submission a reviewer opens – and the YSWS row written just after it, which looks the reel up – already has the video rather than one arriving behind it. It is posted once: a retry after a refused hand-in reuses it. The submission last, and only once it has gone through is the reel offered for posting online.
	 */
	async function submit() {
		if (submitting) return
		setSubmitting(true)
		setSubmitError(null)
		if (project) setProjectTier(project.id, tier)
		let postId = closingPostId
		if (clip && !postId) {
			const posted = await postReel(reelCheckpointId, closingCaption, clip)
			// The button already refuses to submit without a clip, so a closing reel that did not land is the same situation and stops here too: handing the week in without it would leave a reviewer a submission with no video and the maker none the wiser.
			if (posted.error) {
				setSubmitting(false)
				setSubmitError(posted.error)
				return
			}
			postId = posted.postId ?? null
			setClosingPostId(postId)
		}
		const refused = await submitPhase(checkpoint.id, {
			attachmentKeys: carts.map(c => c.objectKey),
			fundingDeclined,
			noMicrocontroller: firmwareMissing && noMicrocontroller,
			notes: isBuild ? buildNotes : undefined,
			partialFundingAccepted: partialFunding,
		})
		setSubmitting(false)
		if (refused) {
			setSubmitError(refused)
			return
		}
		// Into the store rather than local state: the refresh this triggers flips the week to in_review, and the checkpoint router shows the celebration from there so it survives.
		if (postId)
			setSharePost({
				// Design only: build weeks earn flat, so "past your tier" means nothing there. The hours are the week's own total – the same basis the sheet's floor and target read – though a reviewer can still adjust them.
				celebration: !isBuild ? { extraHours: Math.max(0, hours - week.earnFrom) } : undefined,
				checkpointId: checkpoint.id,
				eyebrow: `${weekName(week)} · Submitted`,
				postId,
				videoUrl: clipUrl,
			})
		else setOpenCheckpoint(null)
	}

	// Declining funding is the one choice in this sheet that an edit cannot quietly undo – once handed in without it there is no grant to order – so the box asks once more, following the repo's window.confirm precedent for irreversible choices.
	function toggleDeclinedFunding() {
		if (declinedFunding) {
			setDeclinedFunding(false)
			return
		}
		if (
			window.confirm(
				bomEmpty
					? "Submit with an empty parts list? No parts funding will be ordered for this project. You can still change your mind before you submit."
					: "Submit without any parts funding? Your parts list stays on the project for the reviewer to see, but approving it orders no grant. You can still change your mind before you submit.",
			)
		) {
			setDeclinedFunding(true)
			setAcceptsPartialFunding(false)
		}
	}

	return (
		<Modal
			accent="var(--color-magenta)"
			eyebrow={`Submit ${week.id === WARMUP_WEEK_ID ? "your warm-up" : `week ${week.id}`} · ${step}/${total}`}
			footer={
				<>
					<Button onClick={() => (step === 1 ? setOpenCheckpoint(null) : setStep(s => s - 1))} variant="outline">
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
					{step > 1 && !submitError && nextBlocker() && (
						<p className="hand mr-auto min-w-0 flex-1 text-[0.78rem] leading-snug text-coral-deep" role="alert">
							{nextBlocker()}
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
			}
			onClose={() => setOpenCheckpoint(null)}
			open
			scrollKey={step}
			size="lg"
		>
			{resubmitting && (
				<SubmitNotice
					icon={
						<IconWarning
							className={cx("mt-0.5 shrink-0 text-xl", outOfSubmissions ? "text-coral-deep" : "text-gold-ink")}
						/>
					}
					title={
						outOfSubmissions
							? `All ${SUBMISSION_LIMIT} submissions for this phase are used.`
							: `Submission ${submissionsUsed + 1} of ${SUBMISSION_LIMIT} for this phase`
					}
					tone={outOfSubmissions ? "coral" : "gold"}
				>
					{outOfSubmissions
						? "It stays returned for now. Dispute the review or ask a reviewer in Slack; you cannot submit it again. "
						: submissionsLeft === 1
							? "This is your last one. If it comes back needing changes again, you cannot submit it. "
							: `${submissionsLeft - 1} left after this one. `}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => setOpenCheckpoint(null)}
						>
							Go to project page
						</Link>
					)}
				</SubmitNotice>
			)}

			{/* On every step, not just the last one: a maker who is short on hours should find that out before working through the checklist, not after. It warns and does not block – the hours needed for a printer at all are the trail's gate, and this is the gap to the one they chose. */}
			{!hasCover && (
				<SubmitNotice
					icon={<IconCamera className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title={project ? `${project.name} needs a cover image.` : "Your project needs a cover image."}
				>
					Upload a photo or screenshot of the project on that project&apos;s page before you can submit. Covers are per
					project, so a cover uploaded elsewhere does not count.{" "}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => setOpenCheckpoint(null)}
						>
							Go to project page
						</Link>
					)}
				</SubmitNotice>
			)}

			{!descriptionReady && (
				<SubmitNotice
					icon={<IconPencil className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title={project ? `${project.name} needs a longer description.` : "Your project needs a longer description."}
				>
					A reviewer decides from the description, so it needs at least {MIN_PROJECT_DESCRIPTION_CHARS} characters. You
					have {descriptionLength}.{" "}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => setOpenCheckpoint(null)}
						>
							Edit the description
						</Link>
					)}
				</SubmitNotice>
			)}

			{!starterDescriptionReady && (
				<SubmitNotice
					icon={<IconPencil className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title={
						project
							? `${project.name} still has the starter's description.`
							: "This project still has the starter's description."
					}
				>
					Write your own description. Say what you changed, why you made it, and what makes it yours.{" "}
					{project && (
						<Link
							className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
							href={`/projects/${project.id}`}
							onClick={() => setOpenCheckpoint(null)}
						>
							Edit the description
						</Link>
					)}
				</SubmitNotice>
			)}

			{owed > 0 && (
				<SubmitNotice
					icon={<IconWarning className="mt-0.5 shrink-0 text-xl text-coral-deep" />}
					title="You're a little behind on your printer goal."
				>
					Spend some more time on it! You are <span className="font-bold text-navy tabular-nums">{owed}</span>{" "}
					{owed === 1 ? "coin" : "coins"} behind the pace for a <span className="font-bold text-navy">{goal.name}</span>
					. You can still submit it, and a bigger week later makes it up.
				</SubmitNotice>
			)}

			{step === 1 && (
				<div>
					<ModalTitle
						sub={
							isBuild
								? "Reviewers watch the demo first and read everything else second. Get the video right."
								: "Source files, not exports. A PDF of a schematic is not a schematic."
						}
					>
						Check all files are included
					</ModalTitle>
					{project && (
						<RepoChecks
							onResult={setRepoResult}
							project={project}
							waivedFirmware={firmwareMissing && noMicrocontroller}
						/>
					)}
					{/* The Displays week asks for firmware because most display projects drive one from a microcontroller. Some do not, and have no firmware to give: the box is the maker's confirmation, and it takes only that check off the gate. */}
					{firmwareMissing && (
						<label
							className={cx(
								"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
								noMicrocontroller ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
							)}
							style={{
								"--sk-color": noMicrocontroller ? "var(--color-violet)" : "var(--color-line)",
								"--sk-radius": "16px",
							}}
						>
							<input
								checked={noMicrocontroller}
								className="sr-only"
								onChange={() => setNoMicrocontroller(value => !value)}
								type="checkbox"
							/>
							<span
								aria-hidden="true"
								className={cx(
									"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
									noMicrocontroller ? "border-transparent bg-violet" : "border-line-strong",
								)}
							>
								{noMicrocontroller && <IconCheck className="text-sm text-white" />}
							</span>
							<span className="min-w-0">
								<span className="block text-[0.95rem] font-extrabold text-navy">My project has no microcontroller</span>
								<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
									There is no firmware to include. Tick this to hand the week in without it; a reviewer will see what
									drives the display instead.
								</span>
							</span>
						</label>
					)}
				</div>
			)}

			{!isBuild && step === 2 && (
				<div>
					<ModalTitle
						sub={
							fundingDeclined
								? "No parts, no order. Just the tier your hours unlock."
								: "Every line needs a real vendor and a real price. We ask for the cart screenshot so the total is checkable."
						}
					>
						{fundingDeclined ? "Finalise your tier" : "Finalise your BOM and tier"}
					</ModalTitle>

					{/* Declined funding hides the parts list and its edit note – there is nothing to check. */}
					{!fundingDeclined && (
						<>
							<BomTable bom={bom} bomError={bomError} bomTotal={bomTotal} />
							{/* One place to change the list: the project page. The sheet reads it, so what is handed in is what the maker kept there. */}
							{project && (
								<p className="hand mt-2 text-[0.82rem] text-navy-soft">
									Something wrong?{" "}
									<Link
										className="text-violet-deep underline decoration-dashed underline-offset-4 hover:text-navy"
										href={`/projects/${project.id}#bom-title`}
										onClick={() => setOpenCheckpoint(null)}
									>
										Edit the parts list on the project page
									</Link>
									.
								</p>
							)}
						</>
					)}
					{/* Already stocked, or building from scrap: declining funding hands the week in with no grant and no order. An empty BOM needs it; a stocked one takes it as a choice. */}
					{!isBuild && bom !== null && (
						<label
							className={cx(
								"sketch mt-4 flex w-full cursor-pointer items-start gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-violet has-[input:focus-visible]:ring-offset-2",
								declinedFunding ? "bg-violet-pale" : "bg-white hover:bg-black/[.03]",
							)}
							style={{
								"--sk-color": declinedFunding ? "var(--color-violet)" : "var(--color-line)",
								"--sk-radius": "16px",
							}}
						>
							<input checked={declinedFunding} className="sr-only" onChange={toggleDeclinedFunding} type="checkbox" />
							<span
								aria-hidden="true"
								className={cx(
									"mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors",
									declinedFunding ? "border-transparent bg-violet" : "border-line-strong",
								)}
							>
								{declinedFunding && <IconCheck className="text-sm text-white" />}
							</span>
							<span className="min-w-0">
								<span className="block text-[0.95rem] font-extrabold text-navy">
									I don&apos;t want parts funding for this project
								</span>
								<span className="hand mt-0.5 block text-[0.84rem] leading-snug text-navy-soft">
									{bomEmpty
										? "Submit with an empty parts list. No carts, no order. We'll double-check before you submit."
										: "Your parts list stays for the reviewer to see, but approving it orders no grant, so fund the build yourself. We'll double-check before you submit."}
								</span>
							</span>
						</label>
					)}

					{/* No order, nothing to screenshot: the carts go away with the BOM. */}
					{!fundingDeclined && (
						<div className="mt-8 border-t border-dashed border-line pt-6">
							<div className="grid gap-2">
								<p className="label flex items-center gap-2 text-navy-soft">
									<IconCart className="text-base" /> Screenshots of your cart
								</p>
								<p className="text-[0.88rem] leading-snug text-navy-soft">
									The checkout page with the total visible. Any vendor works. Add one per cart if the order is split.
								</p>
								<ImageUploads folder="sessions" images={carts} label="Cart screenshot" max={10} onChange={setCarts} />
								{/* The gate below is `carts.length > 0`, and until now nothing on screen said so: the Next button simply stayed grey. Named here, next to the box that clears it. */}
								{carts.length === 0 && (
									<p className="mt-1 flex items-start gap-1.5 text-[0.84rem] leading-snug text-coral-deep">
										<IconWarning className="mt-0.5 shrink-0 text-sm" />
										<span>
											At least one cart screenshot is needed before you can carry on. It is what the parts total is
											checked against. One per cart if the order is split across vendors.
										</span>
									</p>
								)}
							</div>
						</div>
					)}

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
										<span
											className={cx("block text-[0.95rem] font-extrabold", short > 0 ? "text-navy-soft" : "text-navy")}
										>
											Tier {t.id}
										</span>
										<span className={cx("hand block text-[0.86rem]", short > 0 ? "text-navy-soft" : "text-teal-ink")}>
											${t.grantUsd} for parts
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
												: `Every hour past this tier's ${t.fundingHours}h earns 5 spendable coins`}
										</span>
										{short === 0 && over && (
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

						{/* A cart past the tier's funding still hands in, as a grant that covers part of it – so the box saying so is a requirement rather than a note, and the shortfall is named in dollars rather than left to be found later. It sits under the tier picker because it is that choice it is about, and it disappears the moment a tier that covers the cart is picked. */}
						{bomOverCap && (
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
										Your parts list is ${funding.totalUsd.toFixed(2)} and {selectedTier.name} funds $
										{selectedTier.grantUsd}, so ${funding.shortfallUsd.toFixed(2)} of it is yours to pay. Tick this to
										hand the week in anyway. A reviewer can still move you up a tier, but that shortfall is yours unless
										they do.
									</span>
								</span>
							</label>
						)}
					</div>
				</div>
			)}

			{((isBuild && step === 2) || (!isBuild && step === 3)) && (
				<div>
					<ModalTitle
						sub={
							isBuild
								? "Thirty to sixty seconds of the project working, with your voice explaining what it does."
								: "One last reel walking through the finished design. Thirty seconds is plenty."
						}
					>
						{isBuild ? "Show it working" : "Final submission reel"}
					</ModalTitle>

					<div className="grid gap-2">
						<p className="label flex items-center gap-2 text-navy-soft">
							<IconCamera className="text-base" /> {isBuild ? "Your demo video" : "Your closing reel"}
						</p>
						<p className="text-[0.88rem] leading-snug text-navy-soft">
							{isBuild
								? "Point the camera at the thing, turn it on, and talk over it."
								: "Pan across the schematic, the layout, and the render."}
						</p>
						<ReelCapture
							objectKey={clip}
							onCaptured={(key, url) => {
								setClip(key)
								setClipUrl(url ?? null)
								setClosingPostId(null)
							}}
						/>
					</div>

					<SubmissionReelPicker
						checkpointKey={reelCheckpointId}
						onSelect={reuseClosingReel}
						selectedId={closingPostId}
					/>

					{isBuild && (
						<div className="mt-6">
							<p className="label mb-2 text-magenta">Does it work?</p>
							<div className="grid gap-2.5 sm:grid-cols-2">
								<OptionRow onClick={() => setWorks("yes")} selected={works === "yes"}>
									<span className="text-[0.95rem] font-bold text-navy">Yes, it does the thing</span>
								</OptionRow>
								<OptionRow onClick={() => setWorks("no")} selected={works === "no"}>
									<span className="text-[0.95rem] font-bold text-navy">Not yet</span>
								</OptionRow>
							</div>

							{works === "no" && (
								<div className="mt-4">
									<Field
										hint="Reviewers pass honest failures and fail silent ones. Say what you would do next."
										id="writeup"
										label="What needs to change"
									>
										<textarea
											className={cx(inputClass, "resize-none")}
											id="writeup"
											onChange={e => setWriteup(e.target.value)}
											placeholder="The display initialises but stays blank. I think the reset pin is floating, so next revision ties it through a 10k to 3V3 and I will bodge it in the meantime."
											rows={5}
											value={writeup}
										/>
									</Field>
									<p
										className={cx(
											"hand mt-1.5 text-right text-[0.76rem] tabular-nums",
											writeup.trim().length >= 40 ? "text-teal-ink" : "text-navy-soft",
										)}
									>
										{writeup.trim().length} / 40 characters
									</p>
								</div>
							)}
						</div>
					)}

					<div className="mt-6 flex flex-wrap items-center gap-2.5">
						<Chip tone="teal">
							<IconCheck className="text-[0.9rem]" /> Files attached
						</Chip>
						{!isBuild && (
							<Chip tone="teal">
								<IconCheck className="text-[0.9rem]" /> BOM ${bomTotal.toFixed(2)} · tier {tier}
							</Chip>
						)}
						<Chip tone={clip ? "teal" : "muted"}>
							{clip ? <IconCheck className="text-[0.9rem]" /> : <IconFilm className="text-[0.9rem]" />}{" "}
							{clip ? "Video attached" : "Video missing"}
						</Chip>
					</div>

					<SubmissionAcknowledgements
						acknowledgedAll={acknowledgedAll}
						acknowledgedFixed={acknowledgedFixed}
						acknowledgedLimit={acknowledgedLimit}
						acknowledgedNoMore={acknowledgedNoMore}
						resubmitting={resubmitting}
						setAcknowledgedAll={setAcknowledgedAll}
						setAcknowledgedFixed={setAcknowledgedFixed}
						setAcknowledgedLimit={setAcknowledgedLimit}
						setAcknowledgedNoMore={setAcknowledgedNoMore}
					/>
				</div>
			)}
		</Modal>
	)
}
