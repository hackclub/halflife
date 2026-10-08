"use client"
import { EmptyState } from "@/app/components/ui"
import type { SankeyDiagram, SankeyNode } from "@/lib/queries/admin"

/**
 * The journey as a Sankey: stages left to right, one box per group of users, and a ribbon per route people actually took between two boxes.
 *
 * Hand-rolled SVG rather than a chart dependency, like the funnel and the pies on this page. The layout is the textbook one: every stage's boxes share a single value scale so a ribbon's thickness means the same headcount everywhere in the diagram, boxes stack in the order the query declared (deliberate, not by size), and each box's outbound ribbons are stacked in the order their targets sit vertically – which is what keeps ribbons from crossing needlessly.
 *
 * There is no "everyone else" or "no activity" box. A person who skips a stage contributes to the box they did reach and their ribbon steps over the gap, so the gap itself is the finding: a wide band bypassing a column is a stage most people never got to. A ribbon that ends is a dead end, which the cumulative funnel cannot draw at all.
 *
 * Ribbons are painted first and boxes on top, so a ribbon that steps over a column passes behind its boxes rather than through their labels.
 */

const NODE_W = 13
/** Vertical gap between boxes in a stage. */
const NODE_PAD = 13
/** Horizontal room for a stage: the box, then the gap its labels need. */
const STAGE_W = 168
const HEADER_H = 34
/** Room under the last stage for the axis of nothing, i.e. breathing space. */
const FOOT_H = 10
/** Below this a box is a hairline and its label would print over its neighbours. */
const LABEL_MIN_H = 13
/**
 * A floor on a BOX only, never on a ribbon.
 *
 * Flooring ribbons as well makes a box's ribbons add up to more than the box, and then the widths stop meaning what the numbers say. Real case from the dev data: 5,202 + 11 + 6 users out of 5,219 is 466.5px of true ribbon inside a 468px box, but the 11 and the 6 are each thinner than the floor and get bumped to 1.5px, so the three overrun the box by 1.5px. A sliver of a cohort then reads wider than the cohort. A box floor keeps a real-but-tiny group visible as a hairline while its ribbons stay on the true scale, so a box's ribbons always sum to the people who continued past it.
 */
const MIN_BOX_H = 1.5

const PALETTE = [
	"var(--color-accent)",
	"var(--color-teal)",
	"var(--color-coin)",
	"var(--color-flame)",
	"var(--color-magenta)",
	"var(--color-ink-strong)",
]

interface Placed extends SankeyNode {
	stage: number
	y0: number
	y1: number
	/** Index into PALETTE, so two boxes of the same branch share a colour across both activity columns. */
	color: string
}

interface Ribbon {
	source: Placed
	target: Placed
	value: number
	/** Source-side span. */
	sy0: number
	sy1: number
	/** Target-side span. */
	ty0: number
	ty1: number
}

const fmt = (n: number) => n.toLocaleString("en-US")

export function UserFlowSankey({ diagram }: { diagram: SankeyDiagram }) {
	const { stages, total } = diagram
	if (total === 0 || diagram.nodes.length === 0) return <EmptyState>No signups yet.</EmptyState>

	const byId = new Map(diagram.nodes.map((n) => [n.id, n]))
	const stageIndex = new Map<string, number>()
	for (const [i, stage] of stages.entries()) for (const id of stage.nodes) stageIndex.set(id, i)

	// One colour per branch name, not per box: "Wrote a devlog" in the first-activity column and in the second are the same branch and must read as the same colour.
	const branchColor = new Map<string, string>()
	for (const node of diagram.nodes) {
		const branch = node.id.replace(/^act\d/, "act")
		if (branchColor.has(branch)) continue
		branchColor.set(branch, PALETTE[branchColor.size % PALETTE.length] ?? PALETTE[0] ?? "var(--color-accent)")
	}

	const placed: Placed[] = diagram.nodes.map((node) => ({
		...node,
		stage: stageIndex.get(node.id) ?? 0,
		y0: 0,
		y1: 0,
		color: branchColor.get(node.id.replace(/^act\d/, "act")) ?? "var(--color-accent)",
	}))

	// A single scale for the whole diagram. A stage's own boxes sum to that stage's headcount, which is at most the whole program, so sizing against the largest stage keeps every ribbon comparable.
	const stageHeads = stages.map((stage) => stage.nodes.reduce((sum, id) => sum + (byId.get(id)?.value ?? 0), 0))
	const widest = Math.max(1, ...stageHeads)
	const maxBoxes = Math.max(1, ...stages.map((s) => s.nodes.length))
	const H = 520
	const plotH = H - (maxBoxes - 1) * NODE_PAD
	const scale = plotH / widest
	/** Box height: floored so a real-but-tiny group is still a hairline. */
	const boxH = (value: number) => Math.max(MIN_BOX_H, value * scale)
	/** Ribbon height: never floored, so a box's ribbons always sum to its continuing headcount. */
	const ribbonH = (value: number) => value * scale

	// Stack each stage's boxes in declared order, top to bottom.
	for (const stage of stages) {
		let y = 0
		for (const id of stage.nodes) {
			const node = placed.find((p) => p.id === id)
			if (!node) continue
			const h = boxH(node.value)
			node.y0 = y
			node.y1 = y + h
			y += h + NODE_PAD
		}
	}

	// Ribbons get their two ends assigned in two passes, because a ribbon's source span belongs to its source box's cursor and its target span to its target box's – and each box has one of each.
	const ribbons: Ribbon[] = diagram.links
		.map((link) => {
			const source = placed.find((p) => p.id === link.source)
			const target = placed.find((p) => p.id === link.target)
			if (!source || !target) return null
			return { source, target, value: link.value, sy0: 0, sy1: 0, ty0: 0, ty1: 0 }
		})
		.filter((r): r is Ribbon => r !== null)

	const place = (side: "out" | "in") => {
		for (const node of placed) {
			const mine = ribbons
				.filter((r) => (side === "out" ? r.source === node : r.target === node))
				// Order by where the other end sits, so ribbons leave a box in the order their destinations are stacked.
				.sort((a, b) => {
					const other = (r: Ribbon) => (side === "out" ? r.target : r.source)
					return other(a).y0 - other(b).y0
				})
			let cursor = node.y0
			for (const ribbon of mine) {
				const h = ribbonH(ribbon.value)
				if (side === "out") {
					ribbon.sy0 = cursor
					ribbon.sy1 = cursor + h
				} else {
					ribbon.ty0 = cursor
					ribbon.ty1 = cursor + h
				}
				cursor += h
			}
		}
	}
	place("out")
	place("in")

	const xOf = (stage: number) => stage * STAGE_W
	const W = xOf(stages.length - 1) + STAGE_W + 40

	const ribbonPath = (r: Ribbon) => {
		const x0 = xOf(r.source.stage) + NODE_W
		const x1 = xOf(r.target.stage)
		const xm = (x0 + x1) / 2
		return `M ${x0} ${r.sy0} C ${xm} ${r.sy0} ${xm} ${r.ty0} ${x1} ${r.ty0} L ${x1} ${r.ty1} C ${xm} ${r.ty1} ${xm} ${r.sy1} ${x0} ${r.sy1} Z`
	}

	const biggest = ribbons.reduce((a, b) => (b.value > (a?.value ?? 0) ? b : a), undefined as Ribbon | undefined)
	const summary = biggest
		? `Largest route: ${fmt(biggest.value)} people from ${biggest.source.label} to ${biggest.target.label}.`
		: ""

	return (
		<div>
			{/* The diagram is wider than the panel on most screens, so it scrolls sideways rather than squashing the ribbons until two routes are indistinguishable. */}
			<div style={{ overflowX: "auto", paddingBottom: "0.25rem" }}>
				<svg
					viewBox={`0 0 ${W} ${H + HEADER_H + FOOT_H}`}
					role="img"
					aria-label={`Participant journey as a Sankey diagram across ${stages.length} stages. ${summary}`}
					style={{ display: "block", minWidth: `${W}px`, width: "100%", maxWidth: `${W}px`, height: "auto" }}
				>
					<defs>
						{ribbons.map((r, i) => (
							<linearGradient
								key={r.source.id + r.target.id}
								id={`sankey-grad-${i}`}
								gradientUnits="userSpaceOnUse"
								x1="0"
								x2={W}
							>
								<stop offset="0%" stopColor={r.source.color} stopOpacity="0.42" />
								<stop offset="100%" stopColor={r.target.color} stopOpacity="0.42" />
							</linearGradient>
						))}
					</defs>

					<g transform={`translate(0 ${HEADER_H})`}>
						{ribbons.map((r, i) => (
							<path key={r.source.id + r.target.id} d={ribbonPath(r)} fill={`url(#sankey-grad-${i})`}>
								<title>{`${fmt(r.value)} people: ${r.source.label} → ${r.target.label}`}</title>
							</path>
						))}

						{placed.map((node) => {
							const x = xOf(node.stage)
							const h = boxH(node.value)
							const mid = (node.y0 + node.y1) / 2
							const showLabel = node.y1 - node.y0 >= LABEL_MIN_H
							return (
								<g key={node.id}>
									<rect x={x} y={node.y0} width={NODE_W} height={h} rx={2} style={{ fill: node.color }}>
										<title>{`${node.label}: ${fmt(node.value)} ${node.value === 1 ? "person" : "people"}`}</title>
									</rect>
									{showLabel && (
										<text
											x={x + NODE_W + 7}
											y={mid}
											dominantBaseline="middle"
											style={{
												fontSize: "11px",
												// A halo in the panel's own colour, so a label stays readable where it crosses a ribbon.
												paintOrder: "stroke",
												stroke: "var(--color-surface-raised)",
												strokeWidth: 3.5,
												strokeLinejoin: "round",
												fill: "var(--color-ink-strong)",
											}}
										>
											{fmt(node.value)}
											<tspan dx="4" style={{ fontWeight: 400, fill: "var(--color-ink-muted)" }}>
												{node.label}
											</tspan>
										</text>
									)}
								</g>
							)
						})}
					</g>

					{stages.map((stage, i) => (
						<text
							key={stage.label}
							x={xOf(i)}
							y={HEADER_H - 12}
							textAnchor="start"
							style={{ fontSize: "11px", fontWeight: 700, fill: "var(--color-ink-muted)" }}
						>
							{stage.label}
						</text>
					))}
				</svg>
			</div>

			<p className="hl-hint" style={{ fontSize: "0.78rem", marginTop: "0.5rem" }}>
				Every ribbon is the same thickness for the same number of people, so widths compare across the whole diagram. A
				ribbon stepping over a column is people who skipped that stage; a ribbon that stops is people whose journey
				ended there. The two activity columns are what people did first and then second, so a devlog-then-reel route is
				a different ribbon from reel-then-devlog.
			</p>
		</div>
	)
}
