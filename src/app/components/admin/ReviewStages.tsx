import type { Route } from "next"
import Link from "next/link"
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
 * Both review stages together, each with its icon and name so the colour is never the only signal. An approved design can also carry where its money stands, said in words beside the approval. `designHref` and `buildHref` turn each stage's badge into a way to see every project at that status.
 */
export function ReviewStages({
	buildHref = null,
	buildStatus,
	designFunding = null,
	designHref = null,
	designStatus,
}: Readonly<{
	buildHref?: Route | null
	buildStatus: string
	designFunding?: FundingState | null
	designHref?: Route | null
	designStatus: string
}>) {
	return (
		<ul className="hl-review-stages">
			<li>
				<IconPencil />
				<span className="hl-review-stages__name">Design</span>
				<span className="hl-review-stages__badges">
					{designHref ? (
						<Link href={designHref} title={`Show only designs ${statusLabel(designStatus)}`}>
							<Badge tone={statusTone(designStatus)}>{statusLabel(designStatus)}</Badge>
						</Link>
					) : (
						<Badge tone={statusTone(designStatus)}>{statusLabel(designStatus)}</Badge>
					)}
					{designFunding ? <Badge tone={FUNDING_TONE[designFunding]}>{FUNDING_STATE_TEXT[designFunding]}</Badge> : null}
				</span>
			</li>
			<li>
				<IconHammer />
				<span className="hl-review-stages__name">Build</span>
				<span className="hl-review-stages__badges">
					{buildHref ? (
						<Link href={buildHref} title={`Show only builds ${statusLabel(buildStatus)}`}>
							<Badge tone={statusTone(buildStatus)}>{statusLabel(buildStatus)}</Badge>
						</Link>
					) : (
						<Badge tone={statusTone(buildStatus)}>{statusLabel(buildStatus)}</Badge>
					)}
				</span>
			</li>
		</ul>
	)
}
