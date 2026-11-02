"use client"

import { type Dispatch, type SetStateAction, useEffect, useMemo, useState } from "react"
import { errorMessage, refusalMessage } from "@/lib/api-error"
import { bomTotalUsd, partsFunding } from "@/lib/bom-policy"
import type { BomLine } from "@/lib/bom-schema"
import { usesStarterDefaultDescription } from "@/lib/config/onboarding"
import { type PrinterGoal, paceTarget, printerById, submitFloorFor } from "@/lib/config/printers"
import { MIN_PROJECT_DESCRIPTION_CHARS, WARMUP_WEEK_ID } from "@/lib/config/program"
import { ENTRY_TIER, getTier, type Tier } from "@/lib/config/tiers"
import { fmtHours } from "@/lib/numbers"
import type { RepoCheckResult } from "@/lib/repo-checks"
import { SUBMISSION_LIMIT } from "@/lib/resubmissions"
import { useStore } from "@/lib/store"
import type { Checkpoint, Project, Week } from "@/lib/types"
import { BomResponseSchema, isWeeksProject, weekName } from "./checkpoint-shared"
import type { UploadedImage } from "./ImageUploads"
import type { SubmissionReel } from "./SubmissionReelPicker"

export interface SubmitSheet {
	acknowledgedAll: boolean
	acknowledgedFixed: boolean
	acknowledgedLimit: boolean
	acknowledgedNoMore: boolean
	bom: { items: BomLine[]; taxShippingUsd: number } | null
	bomEmpty: boolean
	bomError: string | null
	bomOverCap: boolean
	bomTotal: number
	canAdvance: boolean
	carts: UploadedImage[]
	clip: string | null
	closeSheet(): void
	closingPostId: string | null
	declinedFunding: boolean
	descriptionLength: number
	descriptionReady: boolean
	firmwareMissing: boolean
	funding: { shortfallUsd: number; totalUsd: number }
	fundingDeclined: boolean
	goal: PrinterGoal
	hasCover: boolean
	hours: number
	isBuild: boolean
	nextBlocker(): string | null
	noMicrocontroller: boolean
	otherRepoBlocker: boolean
	outOfSubmissions: boolean
	owed: number
	partialFunding: boolean
	project: Project | undefined
	reelCheckpointId: string
	repoReady: boolean
	repoResult: RepoCheckResult | null
	resubmitting: boolean
	reuseClosingReel(reel: SubmissionReel | null): void
	selectedTier: Tier
	setAcceptsPartialFunding: Dispatch<SetStateAction<boolean>>
	setAcknowledgedAll: Dispatch<SetStateAction<boolean>>
	setAcknowledgedFixed: Dispatch<SetStateAction<boolean>>
	setAcknowledgedLimit: Dispatch<SetStateAction<boolean>>
	setAcknowledgedNoMore: Dispatch<SetStateAction<boolean>>
	setCarts: Dispatch<SetStateAction<UploadedImage[]>>
	setClip: Dispatch<SetStateAction<string | null>>
	setClipUrl: Dispatch<SetStateAction<string | null>>
	setClosingPostId: Dispatch<SetStateAction<string | null>>
	setDeclinedFunding: Dispatch<SetStateAction<boolean>>
	setNoMicrocontroller: Dispatch<SetStateAction<boolean>>
	setRepoResult: Dispatch<SetStateAction<RepoCheckResult | null>>
	setStep: Dispatch<SetStateAction<number>>
	setTier: Dispatch<SetStateAction<1 | 2 | 3>>
	setWorks: Dispatch<SetStateAction<"yes" | "no" | null>>
	setWriteup: Dispatch<SetStateAction<string>>
	starterDescriptionReady: boolean
	step: number
	submissionsLeft: number
	submissionsUsed: number
	submit(): Promise<void>
	submitError: string | null
	submitting: boolean
	tier: 1 | 2 | 3
	tierFloor(fundingHours: number): number
	tierShort(fundingHours: number): number
	toggleDeclinedFunding(): void
	total: number
	week: Week
	works: "yes" | "no" | null
	writeup: string
}

/**
 * The submit sheet's state, derived gates and hand-in sequence, kept apart from its markup.
 *
 * Everything that decides whether the next button is live lives here, so the steps and the footer read one answer instead of recomputing it three ways.
 */
export function useSubmitSheet(checkpoint: Checkpoint): SubmitSheet {
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

	const canAdvance = Boolean(
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
						&& acknowledgementsComplete,
	)

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
	 * The tier first, awaited, because it is what the reviewer will be deciding against and what the server prices the parts list and gates the hours on. Fire-and-forget here used to let the hand-in reach the gate before the request had landed, so a tier picked in this sheet was still read at the previous one – a Tier 2 cart refused against Tier 1's grant. Then the closing reel, awaited, so the submission a reviewer opens – and the YSWS row written just after it, which looks the reel up – already has the video rather than one arriving behind it. It is posted once: a retry after a refused hand-in reuses it. The submission last, and only once it has gone through is the reel offered for posting online.
	 */
	async function submit() {
		if (submitting) return
		setSubmitting(true)
		setSubmitError(null)
		if (project) {
			const refusedTier = await setProjectTier(project.id, tier)
			if (refusedTier) {
				setSubmitting(false)
				setSubmitError(refusedTier)
				return
			}
		}
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

	return {
		acknowledgedAll,
		acknowledgedFixed,
		acknowledgedLimit,
		acknowledgedNoMore,
		bom,
		bomEmpty,
		bomError,
		bomOverCap,
		bomTotal,
		canAdvance,
		carts,
		clip,
		closeSheet: () => setOpenCheckpoint(null),
		closingPostId,
		declinedFunding,
		descriptionLength,
		descriptionReady,
		firmwareMissing,
		funding,
		fundingDeclined,
		goal,
		hasCover,
		hours,
		isBuild,
		nextBlocker,
		noMicrocontroller,
		otherRepoBlocker,
		outOfSubmissions,
		owed,
		partialFunding,
		project,
		reelCheckpointId,
		repoReady,
		repoResult,
		resubmitting,
		reuseClosingReel,
		selectedTier,
		setAcceptsPartialFunding,
		setAcknowledgedAll,
		setAcknowledgedFixed,
		setAcknowledgedLimit,
		setAcknowledgedNoMore,
		setCarts,
		setClip,
		setClipUrl,
		setClosingPostId,
		setDeclinedFunding,
		setNoMicrocontroller,
		setRepoResult,
		setStep,
		setTier,
		setWorks,
		setWriteup,
		starterDescriptionReady,
		step,
		submissionsLeft,
		submissionsUsed,
		submit,
		submitError,
		submitting,
		tier,
		tierFloor,
		tierShort,
		toggleDeclinedFunding,
		total,
		week,
		works,
		writeup,
	}
}
