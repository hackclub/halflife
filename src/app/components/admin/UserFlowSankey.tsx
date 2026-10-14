"use client"
import { EmptyState } from "@/app/components/ui"
import { fmtInt as fmt } from "@/lib/numbers"
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
/**
 * Horizontal room for a stage: the box, then the gap its labels need.
 *
 * Wide enough for the longest stage label plus a five-figure count, because the diagram no longer shrinks and a name that ran past its column would sit on the next stage's box.
 */
const STAGE_W = 190
const HEADER_H = 34
/** Room under the last stage for the axis of nothing, i.e. breathing space. */
const FOOT_H = 10
/**
 * A floor on a BOX only, never on a ribbon.
 *
 * Flooring ribbons as well makes a box's ribbons add up to more than the box, and then the widths stop meaning what the numbers say. Real case from the dev data: 5,202 + 11 + 6 users out of 5,219 is 466.5px of true ribbon inside a 468px box, but the 11 and the 6 are each thinner than the floor and get bumped to 1.5px, so the three overrun the box by 1.5px. A sliver of a cohort then reads wider than the cohort. A box floor keeps a real-but-tiny group visible as a hairline while its ribbons stay on the true scale, so a box's ribbons always sum to the people who continued past it.
 *
 * The activity stage fans out and back in – one person feeds every box they earned. Where stacking an edge's ribbons would visibly overflow its box (past NEST_PX), the fan ribbons nest from the box edge instead and the overlap reads darker; everywhere else every ribbon stacks sequentially, so small flows stay visible rather than hiding inside bigger ones. Chain ribbons carry disjoint users and stack in both cases, on top of the fan wash when there is one so real divergences stay readable.
 */
const MIN_BOX_H = 1.5

/**
 * Overshoot past which shared ribbons overlap instead of stacking, in viewBox units (≈ pixels at natural size).
 *
 * Stacking one person's units across several ribbons double-counts them – but only where it shows. A couple of units on a small box is sub-pixel while nesting would swallow its smaller flows whole, so the fan only nests past this many units of overshoot. Past it, the alternative is a visibly oversized box edge; short of it, every flow stays laid out.
 */
const NEST_PX = 2

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
	/** Index into PALETTE, so each activity branch keeps its colour wherever its box sits. */
	color: string
}

interface Ribbon {
	source: Placed
	target: Placed
	value: number
	/** Which edge fans, if either: shared users overlap there instead of adding up. */
	fan: "out" | "in" | null
	/** Source-side span. */
	sy0: number
	sy1: number
	/** Target-side span. */
	ty0: number
	ty1: number
}

export function UserFlowSankey({ diagram }: { diagram: SankeyDiagram }) {
	const { stages, total } = diagram

	if (total === 0 || diagram.nodes.length === 0) return <EmptyState>No signups yet.</EmptyState>

	const xOf = (stage: number) => stage * STAGE_W
	const W = xOf(stages.length - 1) + STAGE_W + 40

	/**
	 * Drawn at its own size inside a scroller, rather than scaled to fit the panel.
	 *
	 * The journey is now as long as the funnel is, so an eighteen-stage diagram squeezed into a laptop panel would take the type down with it until the labels were unreadable. A scroll is how a diagram this wide is meant to be read, and `margin: 0 auto` still centres it whenever the panel is wider than the drawing. The trade is that the type is a fixed 11 viewBox units rather than enlarged to compensate for a shrink, so the label budget below is a straight comparison in those same units.
	 */
	const font = 11
	/**
	 * The vertical slot a label needs, and the reason thin boxes still get one.
	 *
	 * Gating a label on the box being tall enough (the first cut of this) left every small cohort nameless, and a 1.5px box is not a hover target. Boxes in a stage are separated by NODE_PAD, so two hairline boxes often already sit further apart than a line of text is tall: their labels fit side by side without moving. Where they would not fit, the label drops into the next free slot and a leader line ties it back to its box, so a number is never lost – only nudged.
	 */
	const labelSlot = font * 1.45
	/** Gap from a box to its label. */
	const labelGap = font * 0.65
	// ~0.52em per character is a fair average for this face at this size. The budget is the stage's pitch less the box and the gap, because a label starts to the right of its own box: comparing against the whole stage width let the longest name run into the next column's box. `+ 8` covers a five-figure count and the space before the name.
	const widestLabel = Math.max(...diagram.nodes.map((n) => n.label.length)) + 8
	const showNames = font * 0.52 * widestLabel <= STAGE_W - NODE_W - labelGap

	const byId = new Map(diagram.nodes.map((n) => [n.id, n]))
	const stageIndex = new Map<string, number>()
	for (const [i, stage] of stages.entries()) for (const id of stage.nodes) stageIndex.set(id, i)

	// One colour per branch: "Wrote a devlog" is one branch wherever its box sits, and must read as one colour.
	const branchColor = new Map<string, string>()
	for (const node of diagram.nodes) {
		if (branchColor.has(node.id)) continue
		branchColor.set(node.id, PALETTE[branchColor.size % PALETTE.length] ?? PALETTE[0] ?? "var(--color-accent)")
	}

	const placed: Placed[] = diagram.nodes.map((node) => ({
		...node,
		stage: stageIndex.get(node.id) ?? 0,
		y0: 0,
		y1: 0,
		color: branchColor.get(node.id) ?? "var(--color-accent)",
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
			return { source, target, value: link.value, fan: link.fan, sy0: 0, sy1: 0, ty0: 0, ty1: 0 }
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
			// Fan-out ribbons share their source's people across several activity boxes, and fan-in ribbons share their target's across the same activities coming back. Stacking shared ribbons double-counts them – but only where it shows: a few units of overshoot on a small box is sub-pixel, while nesting would hide its smaller flows entirely. So the fan ribbons nest from the box's top edge only when stacking everything would visibly overflow it; otherwise every ribbon stacks sequentially and each flow stays visible.
			const nestable = (r: Ribbon) => (side === "out" ? r.fan === "out" : r.fan === "in")
			const boxSize = node.y1 - node.y0
			const fanTotal = mine.filter(nestable).reduce((n, r) => n + ribbonH(r.value), 0)
			const chainTotal = mine.filter((r) => !nestable(r)).reduce((n, r) => n + ribbonH(r.value), 0)
			if (fanTotal + chainTotal <= boxSize + NEST_PX) {
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
			} else {
				let fanEnd = node.y0
				for (const ribbon of mine.filter(nestable)) {
					const h = ribbonH(ribbon.value)
					if (side === "out") {
						ribbon.sy0 = node.y0
						ribbon.sy1 = node.y0 + h
					} else {
						ribbon.ty0 = node.y0
						ribbon.ty1 = node.y0 + h
					}
					fanEnd = Math.max(fanEnd, node.y0 + h)
				}
				// Chain ribbons carry disjoint users, so they stack after the fan footprint instead of under it: a big chain flow is laid out end to end rather than burying the fan. Fan users plus chain users partition the box, so this always fits.
				let cursor = fanEnd
				for (const ribbon of mine.filter((r) => !nestable(r))) {
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
	// Fan ribbons paint first: they are the shared-user wash underneath, and chain ribbons – real divergences sharing an edge – stay readable on top of it. Stable, so order within each group is untouched.
	const painted = [...ribbons].sort((a, b) => Number(b.fan !== null) - Number(a.fan !== null))
	const summary = biggest
		? `Largest route: ${fmt(biggest.value)} people from ${biggest.source.label} to ${biggest.target.label}.`
		: ""

	return (
		<div>
			{/* A horizontal scroller. The journey is now as long as the funnel's, so the drawing is wider than the panel on every screen and is read by scrolling rather than by shrinking. `overscroll-behavior-x: contain` keeps a sideways trackpad flick at the end of the diagram from turning into a browser back/forward gesture. */}
			<div style={{ overflowX: "auto", overscrollBehaviorX: "contain", paddingBottom: "0.25rem" }}>
				<svg
					viewBox={`0 0 ${W} ${H + HEADER_H + FOOT_H}`}
					role="img"
					aria-label={`Participant journey as a Sankey diagram across ${stages.length} stages. ${summary}`}
					style={{ display: "block", width: `${W}px`, height: "auto", margin: "0 auto" }}
				>
					<defs>
						{painted.map((r, i) => (
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
						{painted.map((r, i) => (
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
				ended there. The activity stage counts every kind each person reached: ribbons sharing people overlap where
				stacking them would visibly overflow, and stack everywhere else so small flows stay visible.
			</p>
		</div>
	)
}
