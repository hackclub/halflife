import { Badge, type BadgeTone, statusLabel, statusTone } from "@/app/components/ui"
import { IconHammer, IconPencil } from "@/app/components/ui/icons"
import { FUNDING_STATE_TEXT, type FundingState } from "@/lib/funding-state"

/** The funding stages in the console's badge tones, so an approved design's stage reads like the rest of the row. */
const FUNDING_TONE: { [_ in FundingState]: BadgeTone } = {
	awaiting_funding: "gold",
	funded: "success",
	queued: "muted",
}

/**
 * Both review stages together, each with its icon and name so the colour is never the only signal. An approved design can also carry where its money stands, said in words beside the approval.
 */
export function ReviewStages({
	buildStatus,
	designFunding = null,
	designStatus,
}: Readonly<{ buildStatus: string; designFunding?: FundingState | null; designStatus: string }>) {
	return (
		<ul className="hl-review-stages">
			<li>
				<IconPencil />
				<span className="hl-review-stages__name">Design</span>
				<Badge tone={statusTone(designStatus)}>{statusLabel(designStatus)}</Badge>
				{designFunding ? <Badge tone={FUNDING_TONE[designFunding]}>{FUNDING_STATE_TEXT[designFunding]}</Badge> : null}
			</li>
			<li>
				<IconHammer />
				<span className="hl-review-stages__name">Build</span>
				<Badge tone={statusTone(buildStatus)}>{statusLabel(buildStatus)}</Badge>
			</li>
		</ul>
	)
}
