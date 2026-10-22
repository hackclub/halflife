import { Badge, statusLabel, statusTone } from "@/app/components/ui"

/** Design is drawn as a pencil and build as a hammer: the stage survives a colour-blind read and a monochrome print. */
export function DesignStageIcon() {
	return (
		<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
			<path
				d="m4 20 1.1-4.2L16.4 4.5a2.1 2.1 0 0 1 3 3L8.1 18.9 4 20Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
			<path d="m14.6 6.3 3.1 3.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
		</svg>
	)
}

export function BuildStageIcon() {
	return (
		<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
			<path
				d="m13.6 5.2 5.2 5.2-2.1 2.1-5.2-5.2 2.1-2.1Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
			<path
				d="M12.7 8.1 4 17v3h3l8.9-8.7"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
		</svg>
	)
}

/** Both review stages together, each with its icon and name so the colour is never the only signal. */
export function ReviewStages({ buildStatus, designStatus }: Readonly<{ buildStatus: string; designStatus: string }>) {
	return (
		<ul className="hl-review-stages">
			<li>
				<DesignStageIcon />
				<span className="hl-review-stages__name">Design</span>
				<Badge tone={statusTone(designStatus)}>{statusLabel(designStatus)}</Badge>
			</li>
			<li>
				<BuildStageIcon />
				<span className="hl-review-stages__name">Build</span>
				<Badge tone={statusTone(buildStatus)}>{statusLabel(buildStatus)}</Badge>
			</li>
		</ul>
	)
}
