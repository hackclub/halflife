import { fmtHours } from "@/lib/numbers"
import { SUBMISSION_LIMIT } from "@/lib/resubmissions"

/** Everything the sheet's Next button and its explanation read. */
export interface SubmitGates {
	acknowledgementsComplete: boolean
	carts: number
	clip: string | null
	descriptionBlocker: string
	descriptionReady: boolean
	fundingDeclined: boolean
	fundingOk: boolean
	hasCover: boolean
	isBuild: boolean
	outOfSubmissions: boolean
	repoReady: boolean
	starterDescriptionBlocker: string
	starterDescriptionReady: boolean
	step: number
	tierBlocked: boolean
	/** How many more design hours the chosen tier needs. */
	tierShortHours: number
	total: number
	works: "yes" | "no" | null
	writeup: string
}

/** Whether the foot button can move on from this step. */
export function canAdvance({
	acknowledgementsComplete,
	carts,
	clip,
	descriptionReady,
	fundingDeclined,
	fundingOk,
	hasCover,
	isBuild,
	outOfSubmissions,
	repoReady,
	starterDescriptionReady,
	step,
	tierBlocked,
	works,
	writeup,
}: SubmitGates): boolean {
	return Boolean(
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
						(carts > 0 || fundingDeclined) && !tierBlocked && fundingOk
					: clip
						&& !tierBlocked
						&& fundingOk
						&& hasCover
						&& descriptionReady
						&& starterDescriptionReady
						&& !outOfSubmissions
						&& acknowledgementsComplete,
	)
}

/** Why the foot button is greyed, in the maker's terms, or null when it is live. */
export function nextBlocker(gates: SubmitGates): string | null {
	const {
		acknowledgementsComplete,
		carts,
		clip,
		descriptionBlocker,
		descriptionReady,
		fundingDeclined,
		fundingOk,
		hasCover,
		isBuild,
		outOfSubmissions,
		starterDescriptionBlocker,
		starterDescriptionReady,
		step,
		tierBlocked,
		tierShortHours,
		total,
		works,
		writeup,
	} = gates
	if (step === 1) return null
	if (outOfSubmissions)
		return `All ${SUBMISSION_LIMIT} submissions for this phase are used. Dispute the review or ask a reviewer in Slack.`
	if (step === total && !acknowledgementsComplete) return "Tick every acknowledgement above before submitting."
	// These two block whichever of the later steps is showing.
	if (tierBlocked)
		return `Your tier needs ${fmtHours(tierShortHours)} more design time than you have logged this week. Pick a tier you have earned.`
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
	if (step === 2) return carts === 0 && !fundingDeclined ? "Add a screenshot of your cart above to carry on." : null
	if (!clip) return "Record your closing reel to carry on."
	if (!hasCover) return "Add a cover image to your project before you can submit."
	if (!descriptionReady) return descriptionBlocker
	if (!starterDescriptionReady) return starterDescriptionBlocker
	return null
}
