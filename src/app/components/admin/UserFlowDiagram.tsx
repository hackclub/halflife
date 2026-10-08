"use client"
import { type KeyboardEvent, useState } from "react"
import { UserFlowFunnel } from "@/app/components/admin/UserFlowFunnel"
import { EmptyState } from "@/app/components/ui"
import type { FlowStep } from "@/lib/queries/admin"

/**
 * The two ways of reading the same participant journey.
 *
 * The funnel is a spine: one path, each stage the people who also cleared everything above it, so the drop-off between two stages is the number to read. It cannot show order that is not the spine's – a maker who added a devlog before posting a reel is counted in both rows with no way to say which came first, and a maker who never posts a reel reads as having dropped out.
 *
 * The Sankey is the other shape: every route side by side, so a step that happens out of order, or on a branch the spine never had, is visible as its own ribbon rather than folded into a chain. Left-to-right, because the axis is progression and the bands are the volume.
 */
const TABS = [
	{ id: "funnel", label: "Funnel", hint: "One spine, top to bottom: each stage also cleared everything above it" },
	{
		id: "sankey",
		label: "Sankey",
		hint: "Every route at once, left to right: out-of-order and side steps get their own ribbon",
	},
] as const

type TabId = (typeof TABS)[number]["id"]

export function UserFlowDiagram({ steps }: { steps: FlowStep[] }) {
	const [active, setActive] = useState<TabId>("funnel")
	const index = TABS.findIndex((t) => t.id === active)
	const current = TABS[index] ?? TABS[0]

	/**
	 * The arrow keys move between tabs, as a tablist is expected to: Left/Right step, Home/End jump to the ends. Only the active tab is in the tab order, so Tab moves out of the group to the diagram, and the roving focus means the arrow keys always have something to act on.
	 */
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
		const edge = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : null
		if (step === 0 && edge === null) return
		event.preventDefault()
		const next = edge ?? (((index + step) % TABS.length) + TABS.length) % TABS.length
		const target = TABS[next]
		if (!target) return
		setActive(target.id)
		document.getElementById(`user-flow-tab-${target.id}`)?.focus()
	}

	return (
		<div>
			<div
				role="tablist"
				aria-label="User flow diagram"
				onKeyDown={onKeyDown}
				style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}
			>
				{TABS.map((tab, i) => {
					const selected = tab.id === active
					return (
						<button
							key={tab.id}
							id={`user-flow-tab-${tab.id}`}
							type="button"
							role="tab"
							aria-selected={selected}
							aria-controls={`user-flow-panel-${tab.id}`}
							// The roving tabindex: only the selected tab is reachable by Tab.
							tabIndex={selected ? 0 : -1}
							className={selected ? "hl-btn hl-btn--primary" : "hl-btn"}
							onClick={() => setActive(tab.id)}
							style={{ cursor: "pointer" }}
						>
							{tab.label}
							{i === 0 ? <span className="hl-hint">top to bottom</span> : null}
						</button>
					)
				})}
			</div>

			<div id={`user-flow-panel-${active}`} role="tabpanel" aria-labelledby={`user-flow-tab-${active}`}>
				{active === "funnel" ? <UserFlowFunnel steps={steps} /> : <SankeyPlaceholder />}
			</div>

			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem", textAlign: "center" }}>
				{current?.hint}
			</p>
		</div>
	)
}

/**
 * Stands in for the Sankey until it is drawn. It says so rather than rendering an empty panel, so nobody reads the blank space as "no data" – the counts are right there on the funnel tab.
 */
function SankeyPlaceholder() {
	return (
		<div style={{ marginTop: "1rem" }}>
			<EmptyState>The Sankey view is not drawn yet. Switch to Funnel for the counts.</EmptyState>
		</div>
	)
}
