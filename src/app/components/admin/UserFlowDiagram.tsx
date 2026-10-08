"use client"
import { useState } from "react"
import { UserFlowFunnel } from "@/app/components/admin/UserFlowFunnel"
import { UserFlowSankey } from "@/app/components/admin/UserFlowSankey"
import { Panel } from "@/app/components/ui"
import type { FlowStep, SankeyDiagram } from "@/lib/queries/admin"

/**
 * The two ways of reading the same participant journey.
 *
 * The funnel is a spine: one path, each stage the people who also cleared everything above it, so the drop-off between two stages is the number to read. It cannot show order that is not the spine's – a maker who added a devlog before posting a reel is counted in both rows with no way to say which came first, and a maker who never posts a reel reads as having dropped out.
 *
 * The Sankey is the other shape: every route side by side, so a step that happens out of order, or on a branch the spine never had, is visible as its own ribbon rather than folded into a chain. Left-to-right, because the axis is progression and the bands are the volume.
 *
 * The two deliberately do not agree. The funnel treats a few stages as "did it, or already did something later that presupposes it" so that a column backfilled mid-program does not shrink everything beneath it; the Sankey reports each stage literally. The gap between the two views is the size of that forgiveness, so read them together rather than picking one.
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

export function UserFlowDiagram({ steps, sankey }: { steps: FlowStep[]; sankey: SankeyDiagram }) {
	const [active, setActive] = useState<TabId>("funnel")
	const index = TABS.findIndex((t) => t.id === active)
	const current = TABS[index] ?? TABS[0]

	/**
	 * The arrow keys move between tabs, as a tablist is expected to: Left/Right step, Home/End jump to the ends. Only the active tab is in the tab order, so Tab moves out of the group to the diagram, and the roving focus means the arrow keys always have something to act on.
	 */
	const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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

	// The Sankey is far wider than the page's reading column, so the panel goes full-bleed while it is up. The funnel is a narrow top-to-bottom shape and stays in the column, where it reads better. The tabs and the diagram live inside this panel rather than beside it, because the tab choice is what changes the panel's width – a page-level panel could not know which tab is selected.
	const wide = active === "sankey"

	return (
		<Panel
			title="User flow"
			actions={
				<span className="hl-hint" style={{ fontSize: "0.78rem" }}>
					each step includes everyone who completed every step above it
				</span>
			}
			wide={wide}
		>
			<div
				role="tablist"
				aria-label="User flow diagram"
				onKeyDown={onKeyDown}
				style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}
			>
				{TABS.map((tab) => {
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
							{tab.id === "funnel" ? <span className="hl-hint">top to bottom</span> : null}
						</button>
					)
				})}
			</div>

			<div id={`user-flow-panel-${active}`} role="tabpanel" aria-labelledby={`user-flow-tab-${active}`}>
				{active === "funnel" ? <UserFlowFunnel steps={steps} /> : <UserFlowSankey diagram={sankey} />}
			</div>

			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.75rem", textAlign: "center" }}>
				{current?.hint}
			</p>
		</Panel>
	)
}
