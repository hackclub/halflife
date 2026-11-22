import type { ReviewEntry } from "@/lib/review-platform/types"

/**
 * The justification a website approval sends to the unified database, in Fabricate's format.
 *
 * Fabricate does not lean on the base's `Automation - Unified Justification` formula: the review screen composes the whole account – when and by whom it was approved, the evidence behind the time, every devlog with its claimed and approved hours, and each entry the reviewer cut with the reason they gave – and writes it to `Optional - Override Hours Spent Justification`, which the formula sends verbatim in place of everything else (see `unifiedJustification` in lib/airtable/unified-justification). That is the only shape the per-entry deflation fits: the formula has one deflation slot for one total and one reason.
 *
 * No `server-only`: the decision panel builds it in the browser from what is on screen, so the reviewer can read and edit it before approving. The server appends the sign-off (see `signedJustification`), so the reviewer cannot approve without one.
 *
 * Decisions made on Ari do not come through here. They keep writing the separate `Justification - …` columns, which the formula still merges for them.
 */

/** What the text needs from the server, fixed for one page load. */
export interface JustificationContext {
	/** The Hackatime account the maker gave us. */
	hackatimeId: string | null
	/** The Hackatime projects linked to this phase. */
	hackatimeProjects: string[]
	/** The first paragraph: which hand-in of which project, and when it was submitted. */
	intro: string
	/** The journalling rules the time was checked against. */
	journalingUrl: string
	/** The project's page, which every devlog link anchors into. Empty when the deployment has no public origin. */
	projectUrl: string
	repoLink: string | null
	/** What the server puts after the reviewer's text. Shown under the box as a tail that cannot be edited. */
	signOff: string
	/** What a "shipped" hand-in has to have. */
	submittingUrl: string
	/** The program's time zone, which the approval stamp is written in. */
	timeZone: string
}

export interface JustificationInput {
	approvedAt: Date
	/** The total an approval freezes: the hours override when one is set, else the computed total. */
	approvedHours: number
	/** What the row's `Hours spent (self reported)` holds: the journal claims plus Hackatime. */
	claimedHours: number
	context: JustificationContext
	entries: readonly ReviewEntry[]
	hackatimeHours: number
	/** The approving reviewer's display name. */
	reviewer: string
	technicalFeatures: string
}

/** The contact line every approval ends with. */
export const REVIEW_CONTACT_EMAIL = "liam@hackclub.com"

/** The sign-off the server appends to a website approval's justification. */
export const justificationSignOff = (reviewer: string): string =>
	`This project was reviewed and approved by @${reviewer}.\n\nFor any questions, please reach out to ${REVIEW_CONTACT_EMAIL}`

/** The reviewer's text with the sign-off after it, as it is stored and written to the base. */
export const signedJustification = (text: string, reviewer: string): string =>
	[text.trim(), justificationSignOff(reviewer)].filter(Boolean).join("\n\n")

const shortDate = (iso: string): string =>
	new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC", year: "numeric" })

const fromSeconds = (seconds: number): string => (seconds / 3600).toFixed(1)

const fromHours = (hours: number): string => hours.toFixed(1)

const entryLabel = (entry: ReviewEntry): string => `${shortDate(entry.date)}${entry.title ? ` ${entry.title}` : ""}`

const approvedOf = (entry: ReviewEntry): number => entry.approvedSeconds ?? entry.secondsSpent

const oneLine = (text: string): string => text.trim().replaceAll(/\s+/g, " ")

/** "November 20, 2026 at 14:05 EST", in the program's time zone. */
export function approvalStamp(date: Date, timeZone: string): string {
	const parts: { [_: string]: string } = {}
	const format = new Intl.DateTimeFormat("en-US", {
		day: "numeric",
		hour: "2-digit",
		hourCycle: "h23",
		minute: "2-digit",
		month: "long",
		timeZone,
		timeZoneName: "short",
		year: "numeric",
	})
	for (const part of format.formatToParts(date)) parts[part.type] = part.value
	return `${parts.month} ${parts.day}, ${parts.year} at ${parts.hour}:${parts.minute} ${parts.timeZoneName}`
}

/** One devlog in the supporting evidence: a link to it on the project page, its date and title, and what it claimed against what was approved. */
function devlogLine(entry: ReviewEntry, projectUrl: string): string {
	const where = projectUrl ? `${projectUrl}#entry-${entry.id} - ` : ""
	const time = entry.countsHours
		? `claimed ${fromSeconds(entry.secondsSpent)}h, approved ${fromSeconds(approvedOf(entry))}h`
		: "time counted through Hackatime"
	return `- ${where}${shortDate(entry.date)}${entry.title ? `: ${entry.title}` : ""} (${time})`
}

/**
 * The hours paragraph: the totals, then every entry the reviewer cut with the reason they gave.
 *
 * A total set by hand – the override a stale Hackatime reading needs – is not explained by the entries, so it is said outright rather than left as a gap between the list and the figure.
 */
function hoursSection(input: JustificationInput): string {
	const counted = input.entries.filter(entry => entry.countsHours)
	const deflated = counted.filter(entry => entry.approvedSeconds !== null && entry.approvedSeconds < entry.secondsSpent)
	const deflatedSeconds = deflated.reduce((sum, entry) => sum + entry.secondsSpent - approvedOf(entry), 0)
	const deflation =
		deflated.length > 0
			? `${fromSeconds(deflatedSeconds)} hours of deflation was applied:\n${deflated
					.map(entry => {
						const note = entry.reviewerNote?.trim() ? `. ${oneLine(entry.reviewerNote)}` : ""
						return `- ${entryLabel(entry)}: ${fromSeconds(entry.secondsSpent)}h to ${fromSeconds(approvedOf(entry))}h${note}`
					})
					.join("\n")}`
			: "No deflation was applied."
	const fromEntries = counted.reduce((sum, entry) => sum + approvedOf(entry), 0) / 3600 + input.hackatimeHours
	const byHand =
		Math.abs(fromEntries - input.approvedHours) >= 0.05
			? `\nThe approved total was set to ${fromHours(input.approvedHours)}h by the reviewer; the entries and Hackatime come to ${fromHours(fromEntries)}h.`
			: ""
	return `Hours claimed: ${fromHours(input.claimedHours)}. Hours approved: ${fromHours(input.approvedHours)}.\n${deflation}${byHand}`
}

/** The generated justification, without the sign-off. */
export function composeJustification(input: JustificationInput): string {
	const { context, entries } = input
	const dates = entries.map(entry => entry.date).toSorted()
	const first = dates.at(0)
	const last = dates.at(-1)
	const range = first && last ? ` from ${shortDate(first)} to ${shortDate(last)}` : ""
	const lapsed = entries.filter(entry => entry.timelapseUrls.length > 0)
	const timelapses =
		lapsed.length > 0
			? `Timelapses: ${lapsed.length} of ${entries.length} entries have one.\n${lapsed.map(entry => `- ${entryLabel(entry)}: ${entry.timelapseUrls.join(", ")}`).join("\n")}`
			: "Timelapses: none linked."
	const hackatime =
		context.hackatimeProjects.length > 0 || input.hackatimeHours > 0
			? `Hackatime: ${fromHours(input.hackatimeHours)}h tracked${context.hackatimeProjects.length > 0 ? ` in ${context.hackatimeProjects.join(", ")}` : ""}${context.hackatimeId ? ` (Hackatime ID ${context.hackatimeId})` : ""}.`
			: null
	const features = oneLine(input.technicalFeatures)

	return [
		context.intro,
		`This project was approved at ${approvalStamp(input.approvedAt, context.timeZone)}`,
		`The project was checked to ensure it meets our requirements of a "shipped" hardware project, which are set out here: ${context.submittingUrl} Journaling time was then verified/deflated by @${input.reviewer} to ensure it meets our policies, set out here: ${context.journalingUrl}`,
		[
			`Time evidence: ${entries.length} journal entries${range}, ${fromHours(input.claimedHours)}h claimed, ${fromHours(input.approvedHours)}h counted after review.`,
			hackatime,
			timelapses,
		]
			.filter(Boolean)
			.join("\n"),
		features && `Technical features: ${features}`,
		[
			"Supporting evidence:",
			`- Repository: ${context.repoLink ?? ""}`,
			`- Project page: ${context.projectUrl}`,
			`- Devlogs: ${entries.length} entries`,
			...entries.map(entry => devlogLine(entry, context.projectUrl)),
		].join("\n"),
		hoursSection(input),
	]
		.filter(Boolean)
		.join("\n\n")
}

/** Which lines of `base` survive in `other`, and what `other` inserted before each of them (and at the end), by longest common subsequence. */
function alignLines(base: readonly string[], other: readonly string[]): { inserted: string[][]; kept: boolean[] } {
	const width = other.length + 1
	const lcs = Array.from({ length: (base.length + 1) * width }, () => 0)
	const at = (b: number, o: number): number => lcs[b * width + o] ?? 0
	for (let b = base.length - 1; b >= 0; b--)
		for (let o = other.length - 1; o >= 0; o--)
			lcs[b * width + o] = base[b] === other[o] ? at(b + 1, o + 1) + 1 : Math.max(at(b + 1, o), at(b, o + 1))
	const kept = Array.from({ length: base.length }, () => false)
	const inserted: string[][] = Array.from({ length: base.length + 1 }, () => [])
	let i = 0
	let j = 0
	while (i < base.length || j < other.length)
		if (i < base.length && j < other.length && base[i] === other[j]) {
			kept[i++] = true
			j++
		} else if (i < base.length && (j === other.length || at(i + 1, j) >= at(i, j + 1))) i++
		else inserted[i]?.push(other[j++] ?? "")
	return { inserted, kept }
}

/**
 * A three-way merge by line: the reviewer's edits of `base`, carried onto `generated`, the text regenerated since.
 *
 * So a reviewer who edits the justification and then deflates another entry keeps their edits and still gets the new deflation line. Fabricate's `mergeEdits`, unchanged in behaviour.
 */
export function mergeEdits(base: string, edited: string, generated: string): string {
	if (edited === base || generated === base) return edited === base ? generated : edited
	const lines = base.split("\n")
	const ours = alignLines(lines, edited.split("\n"))
	const theirs = alignLines(lines, generated.split("\n"))
	const out: string[] = []
	for (let i = 0; i <= lines.length; i++) {
		const ourInserted = ours.inserted[i] ?? []
		const theirInserted = theirs.inserted[i] ?? []
		const ourGap = i > 0 && !ours.kept[i - 1]
		const theirGap = i > 0 && !theirs.kept[i - 1]
		if (ourGap && theirGap && ourInserted.length > 0) out.push(...ourInserted)
		else if (theirGap) out.push(...theirInserted, ...ourInserted)
		else out.push(...ourInserted, ...theirInserted)
		const line = lines[i]
		if (line !== undefined && ours.kept[i] && theirs.kept[i]) out.push(line)
	}
	return out.join("\n")
}

/**
 * An edit to the box, with the sign-off held fixed: what the body becomes, and where the caret goes.
 *
 * The sign-off is shown in the same textarea but is the server's to write, so typing into it, or deleting across it, only changes the body before it. Fabricate's `editBeforeTail`, unchanged in behaviour.
 */
export function editBeforeTail(
	shown: string,
	value: string,
	caretAt: number,
	tail: string,
): { body: string; caret: number } {
	const bodyLength = shown.length - tail.length
	let caret = caretAt
	let after = value.length - caret
	if (after > shown.length || shown.slice(shown.length - after) !== value.slice(caret)) {
		after = 0
		while (after < Math.min(shown.length, value.length) && shown.at(-after - 1) === value.at(-after - 1)) after++
		caret = value.length - after
	}
	let start = 0
	const limit = Math.min(caret, shown.length - after)
	while (start < limit && shown.codePointAt(start) === value.codePointAt(start)) start++
	const from = Math.min(start, bodyLength)
	const to = Math.max(from, Math.min(shown.length - after, bodyLength))
	const inserted = value.slice(start, caret)
	const body = shown.slice(0, from) + inserted + shown.slice(to, bodyLength)
	return { body, caret: inserted || from < to ? from + inserted.length : shown.length - after }
}
