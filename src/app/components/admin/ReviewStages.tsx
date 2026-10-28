import { Badge, statusLabel, statusTone } from "@/app/components/ui"
import { IconHammer, IconPencil } from "@/app/components/ui/icons"

/** Both review stages together, each with its icon and name so the colour is never the only signal. */
export function ReviewStages({ buildStatus, designStatus }: Readonly<{ buildStatus: string; designStatus: string }>) {
	return (
		<ul className="hl-review-stages">
			<li>
				<IconPencil />
				<span className="hl-review-stages__name">Design</span>
				<Badge tone={statusTone(designStatus)}>{statusLabel(designStatus)}</Badge>
			</li>
			<li>
				<IconHammer />
				<span className="hl-review-stages__name">Build</span>
				<Badge tone={statusTone(buildStatus)}>{statusLabel(buildStatus)}</Badge>
			</li>
		</ul>
	)
}
