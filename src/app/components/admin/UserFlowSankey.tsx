"use client"
import { useEffect, useRef, useState } from "react"
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

/** Clearance inside the panel so the outermost labels are not flush against its edge. */
const LABEL_PAD = 10

export function UserFlowSankey({ diagram }: { diagram: SankeyDiagram }) {
	const { stages, total } = diagram
	const scroller = useRef<HTMLDivElement>(null)
	/** Width the panel actually gave us, so the drawing can be sized to it. */
	const [avail, setAvail] = useState(0)

	useEffect(() => {
		const el = scroller.current
		if (!el) return
		const read = () => setAvail(el.getBoundingClientRect().width)
		read()
		// A ResizeObserver rather than a window resize listener: the panel also changes width when the tab flips between the narrow funnel and the full-bleed Sankey, which fires no window resize at all.
		const observer = new ResizeObserver(read)
		observer.observe(el)
		return () => observer.disconnect()
	}, [])

	if (total === 0 || diagram.nodes.length === 0) return <EmptyState>No signups yet.</EmptyState>

	const xOf = (stage: number) => stage * STAGE_W
	const W = xOf(stages.length - 1) + STAGE_W + 40

	/**
	 * Fit the space given rather than insisting on its own width.
	 *
	 * The drawing is laid out in fixed viewBox units and the SVG scales to whatever it is given, so a narrow window shrinks the whole diagram instead of pushing its sides out of reach. Two things compensate for that shrink, because a scaled-down SVG scales its text too: type is enlarged in viewBox units by the inverse of the shrink so it still renders at its intended size, and the label slot grows with it so labels never overlap. Once a stage's share of the width can no longer hold a number plus its name, the name drops and the number stands alone, with the full label still in the tooltip.
	 */
	const box = Math.max(0, avail - LABEL_PAD * 2)
	const fit = box > 0 ? Math.min(1, box / W) : 1
	const font = Math.min(26, 11 / fit)
	/**
	 * The vertical slot a label needs, and the reason thin boxes still get one.
	 *
	 * Gating a label on the box being tall enough (the first cut of this) left every small cohort nameless, and a 1.5px box is not a hover target. Boxes in a stage are separated by NODE_PAD, so two hairline boxes often already sit further apart than a line of text is tall: their labels fit side by side without moving. Where they would not fit, the label drops into the next free slot and a leader line ties it back to its box, so a number is never lost – only nudged. The slot tracks the font so it still holds when type is enlarged to compensate for a shrink, and it is deliberately roomier than the em: a rendered text box runs to about 1.35em, and a 1.15em slot let neighbours touch.
	 */
	const labelSlot = font * 1.45
	/** Gap from a box to its label. */
	const labelGap = font * 0.65
	// A label gets the gap between its own box and the next one, which the SVG then scales: STAGE_W of viewBox units at whatever the shrink is. Measuring it in the same units as the text it has to hold is the whole point – comparing a viewBox-unit text width against a screen-pixel budget reads as "too tight" at widths where the name actually fits, and drops it for no reason.
	const screenScale = box > 0 ? box / W : 1
	// ~0.52em per character is a fair average for this face at these sizes. The longest label plus room for a five-figure count sets the budget for every stage.
	const widestLabel = Math.max(...diagram.nodes.map((n) => n.label.length)) + 8
	const showNames = font * 0.52 * widestLabel * screenScale <= STAGE_W * screenScale

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

	/**
	 * Give every box a label row, not just the tall ones.
	 *
	 * Within a stage, boxes are stacked in y order and each label takes the next free slot below the last, so no two labels in a column can collide. A label that ends up off its own box's centre gets a leader line tying it back. Boxes are top-aligned and a sparse stage uses a fraction of the plot height, so there is nearly always room; a label is dropped only when the plot is genuinely full, which on real data never happens – every box ends up named.
	 */
	const labelRows = new Map<string, { y: number; home: number }>()
	for (const stage of stages) {
		const boxes = stage.nodes
			.map((id) => placed.find((p) => p.id === id))
			.filter((p): p is Placed => p !== undefined)
			.sort((a, b) => a.y0 - b.y0)
		if (boxes.length === 0) continue

		const rows: { node: Placed; y: number; home: number }[] = []
		let lastBottom = Number.NEGATIVE_INFINITY
		for (const node of boxes) {
			const home = (node.y0 + node.y1) / 2
			// A label centred here occupies [y - slot/2, y + slot/2], so clearing the previous label's bottom edge costs half a slot, not a whole one. Reserving a whole slot shoves every label off its own box, even though boxes in a stage sit NODE_PAD apart – already more than a line of text is tall – and a diagram covered in leader lines is harder to read than one with a few.
			const y = Math.max(home, lastBottom + labelSlot / 2)
			rows.push({ node, y, home })
			lastBottom = y + labelSlot / 2
		}

		// Lift the run only if it would fall off the bottom of the plot. Re-centring it unconditionally is worse than doing nothing: a stage whose boxes are unevenly weighted has its label run centred well below them, so every label gets dragged off a box it was already sitting on, and every one grows a leader line.
		const first = rows[0]
		if (!first) continue
		const lift = Math.min(lastBottom - H, first.y - labelSlot / 2)
		if (lift > 0) for (const row of rows) row.y -= lift

		for (const row of rows) {
			// Off the bottom of the plot: no slot left, so this box goes unlabelled rather than printed over the caption.
			if (row.y + labelSlot / 2 > H) continue
			labelRows.set(row.node.id, { y: row.y, home: row.home })
		}
	}

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
			<div ref={scroller} style={{ paddingBottom: "0.25rem" }}>
				<svg
					viewBox={`0 0 ${W} ${H + HEADER_H + FOOT_H}`}
					role="img"
					aria-label={`Participant journey as a Sankey diagram across ${stages.length} stages. ${summary}`}
					style={{ display: "block", width: "100%", maxWidth: `${W}px`, height: "auto" }}
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

						{/* Leader lines first, so a label's halo paints over its own line. */}
						{placed.map((node) => {
							const slot = labelRows.get(node.id)
							if (!slot || Math.abs(slot.y - slot.home) < 0.5) return null
							return (
								<line
									key={`lead-${node.id}`}
									x1={xOf(node.stage) + NODE_W}
									y1={slot.home}
									x2={xOf(node.stage) + NODE_W + labelGap - 2}
									y2={slot.y}
									style={{ stroke: "var(--color-ink-muted)", strokeWidth: 0.75, opacity: 0.55 }}
								/>
							)
						})}

						{placed.map((node) => {
							const x = xOf(node.stage)
							const h = boxH(node.value)
							const slot = labelRows.get(node.id)
							return (
								<g key={node.id}>
									<rect x={x} y={node.y0} width={NODE_W} height={h} rx={2} style={{ fill: node.color }}>
										<title>{`${node.label}: ${fmt(node.value)} ${node.value === 1 ? "person" : "people"}`}</title>
									</rect>
									{slot && (
										<text
											x={x + NODE_W + labelGap}
											y={slot.y}
											dominantBaseline="middle"
											style={{
												fontSize: `${font}px`,
												// A halo in the panel's own colour, so a label stays readable where it crosses a ribbon or a neighbour's leader line.
												paintOrder: "stroke",
												stroke: "var(--color-surface-raised)",
												strokeWidth: font * 0.32,
												strokeLinejoin: "round",
												fill: "var(--color-ink-strong)",
											}}
										>
											{fmt(node.value)}
											{showNames ? (
												<tspan dx={font * 0.36} style={{ fontWeight: 400, fill: "var(--color-ink-muted)" }}>
													{node.label}
												</tspan>
											) : null}
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
							style={{ fontSize: `${font * 0.92}px`, fontWeight: 700, fill: "var(--color-ink-muted)" }}
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
