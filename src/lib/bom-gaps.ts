import type { RepoCheck } from "@/lib/repo-checks"

/**
 * The parts on a BOM a reviewer or the funding cannot use as they stand.
 *
 * A line with no price adds nothing to the parts total, so it is priced as free, and a line with no buy link leaves a reviewer nowhere to check it. Both are shown as one amber row before hand-in. Pure, so the rule can be tested without a database.
 */
export interface BomGaps {
	unlinked: number
	unpriced: number
}

export function bomGaps(lines: readonly { link: string | null; unitCostUsd: number }[]): BomGaps {
	const unpriced = lines.filter(line => !(line.unitCostUsd > 0)).length
	const unlinked = lines.filter(line => !line.link?.trim()).length
	return { unlinked, unpriced }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

/** The amber row for the gaps, or null when every part has a price and a link. */
export function bomGapCheck(gaps: BomGaps): RepoCheck | null {
	if (gaps.unpriced === 0 && gaps.unlinked === 0) return null
	const problems = [
		gaps.unpriced > 0 ? `${plural(gaps.unpriced, "part")} with no price` : null,
		gaps.unlinked > 0 ? `${plural(gaps.unlinked, "part")} with no buy link` : null,
	].filter((text): text is string => text !== null)
	return {
		detail: `${problems.join(" and ")}. A part with no price adds nothing to your parts total, so it is not funded. You can still hand this in, but fix the list first.`,
		key: "bom_gaps",
		label: "Parts without a price or link",
		status: "warn",
	}
}
