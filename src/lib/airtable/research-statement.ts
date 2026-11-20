/**
 * The statement every `Justification - Additional Justification` cell carries, ahead of the link to the project on Half Life.
 *
 * Pure, so the review screen's preview can show the same text the base will hold.
 */
export const RESEARCH_TIME_STATEMENT =
	"Any time spent reading datasheets, sourcing components, and other research is not deflated as long as it accounts for <30% of total claimed/recorded time (hardware research trial approved by Emme)"

/** The project link at the end of a cell, with the blank line that separates it from what is before it. */
const LINK_LINE = /(?:^|\n\n)(Project on Half Life: [^\n]*)$/

/**
 * A cell with the statement placed before the project link, or at the end when there is no link. A cell that already has the statement is returned as it is, so running this twice writes nothing new.
 */
export function withResearchStatement(cell: string): string {
	if (cell.includes(RESEARCH_TIME_STATEMENT)) return cell
	const link = LINK_LINE.exec(cell)
	const head = link ? cell.slice(0, link.index) : cell
	const tail = link?.[1] ?? ""
	return [head.trim(), RESEARCH_TIME_STATEMENT, tail].filter(Boolean).join("\n\n")
}
