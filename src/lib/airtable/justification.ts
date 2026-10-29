import { fmtHours } from "@/lib/numbers"
import { DAY_MS } from "@/lib/time"
import "server-only"
import { scheduledWeekFor } from "@/lib/config/program"
import { Phase, type Theme } from "@/lib/enums"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * The `Justification - …` columns of a submission row, and the text behind them.
 *
 * Three of the five are evidence the maker produced – their Hackatime identity, the Hackatime projects they tracked time in, and the timelapses they recorded – one is the account of what they actually built, and the last is the method the hours rest on when there is neither Hackatime nor Lapse evidence to point at. They sit together on the row because the pipeline merges them into one justification blob (`Automation - Unified Justification`), where the evidence lands under `[HACKATIME]` and the account under `[SPECIFIC TECHNICAL FEATURES]`. A row with an empty account gives the pipeline an empty blob, which is why the account is written from the maker's own work rather than left to the pipeline, and why it is the one column that is always present – see `NO_FEATURES_RECORDED`.
 *
 * Everything a maker wrote is kept as the maker's words: the description they wrote, the parts they listed, the journal entries they kept. The alternate-tracking column is the exception: when devlogs are the only evidence, the reviewer's own reasoning is the part that says how those entries account for the hours, so it is the one justification a reviewer's words belong in (see `alternateTrackingJustification`).
 */

/** One journal entry, as far as a justification cares. */
export interface JustificationSession {
	/** The maker's own write-up of the sitting. Null when they claimed hours without saying anything. */
	content: string | null
	createdAt: Date
	/** The program date the entry is filed under, when it carries one. */
	effectiveDate: string | null
	hoursClaimed: number
	title: string
}

/** One line of the parts list. */
export interface JustificationPart {
	name: string
	/** What the part is for on the board, in the maker's words. */
	purpose: string | null
	quantity: number
}

/** One timelapse, as far as a justification cares: where it is watched. */
export interface JustificationTimelapse {
	externalId: string | null
	objectKey: string | null
	playbackUrl: string | null
	provider: string
}

/** Everything a justification is built from. */
export interface JustificationSource {
	bomItems: JustificationPart[]
	description: string | null
	/** The Hackatime project names linked to this phase, without the week they were tracked in. */
	hackatimeProjects: string[]
	/** The Hackatime account the maker gave us. */
	hackatimeUserId: string | null
	/** The timelapse links of this phase. */
	lapseLinks: string[]
	workSessions: JustificationSession[]
}

/**
 * The values for the justification columns, with an evidence column left out entirely when we have nothing to put in it.
 *
 * An evidence column is written with what we hold and left alone when we hold nothing. A blank written over one erases the only record of it, and for the pre-season rows Half Life imported, the Lapse links came from the form and were never handed to Postgres as timelapses – so a blank there would destroy evidence the base is the only place to find.
 *
 * `specificTechnicalFeatures` is the exception: it is never omitted. The pipeline's merged blob has a `[SPECIFIC TECHNICAL FEATURES]` section whether or not we fill it, and a grant reviewer reads that section first – an empty one is a submission with no account of what was built. Every row therefore carries the maker's text, or the marker in `NO_FEATURES_RECORDED` when they left nothing to say.
 *
 * `alternateTracking` is filled only when there is no Hackatime or Lapse evidence to point at. See `alternateTrackingJustification` for what it says and when.
 */
export interface JustificationValues {
	alternateTracking?: string
	hackatimeId?: string
	hackatimeProjects?: string
	lapseLinks?: string
	specificTechnicalFeatures: string
}

/** The most text worth sending. A reviewer reads a summary of the work, not a journal dump. */
const MAX_CHARS = 8_000

/**
 * What the technical-features column says when the maker left nothing to build it from.
 *
 * The column is loaded into the pipeline's `[SPECIFIC TECHNICAL FEATURES]` section on every row, and a section with nothing under it reads as a gap rather than as "nothing was recorded". A submission cannot normally reach here – the submit gate refuses a project with no description – so this is the guarantee for an imported or historical row rather than a common answer.
 */
export const NO_FEATURES_RECORDED = "No technical description or build log was recorded for this submission."

/** How much of one journal entry is quoted. */
const EXCERPT_CHARS = 300

/**
 * The lines the warm-up import folds into a session's text.
 *
 * The pre-season form's submission was turned into one session carrying the description and the links that came with it, so quoting that session would only repeat what the description above it already says. Only a link counts as one of those: a maker's own journal entry that opens with "Journal:" is their words and stays.
 */
const EVIDENCE_LINE = /^(journal|playable|timelapse)\s*:\s*(https?:\/\/\S+|N\/?A)$/i

/**
 * How much of the description's opening has to match before an entry counts as the description.
 *
 * A maker who edits their project description after the pre-season import leaves the old one in the session's text, and it is quoted as a journal entry unless it is recognised as the description it was.
 */
const OPENING_CHARS = 40

/** YYYY-MM-DD, in UTC – the program's week maths is UTC-anchored too. */
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The links a phase's timelapses are watched at.
 *
 * A recording made on Lapse is watched on Lapse, by its own id. Anything older was uploaded and is watched where it was put: the playback URL the row already carries, or R2 by its object key.
 */
export function timelapseLinks(timelapses: readonly JustificationTimelapse[]): string[] {
	return timelapses
		.map(t =>
			t.provider === "lapse" && t.externalId
				? lapseTimelapseUrl(t.externalId)
				: (t.playbackUrl ?? publicUrlFor(t.objectKey)),
		)
		.filter((url): url is string => Boolean(url))
}

/**
 * The `Justification - Specific Technical Features` text: what the project is, what it is made of, and what was worked on.
 *
 * The description is the maker's own account and the parts are the concrete build, so together they answer "what is this, technically". The log adds what was actually done and how long it took, which is the part a reviewer cannot get from the repo.
 */
export function specificTechnicalFeatures(source: JustificationSource, phase: Phase): string {
	const description = source.description?.trim() ?? ""
	const parts = source.bomItems.map(partLine).filter((line): line is string => line !== null)
	const entries = source.workSessions
		.map(session => sessionLine(session, description))
		.filter((line): line is string => line !== null)

	const heading = phase === Phase.DESIGN ? "Design log" : "Build log"
	const build = (log: string[]) =>
		[
			description,
			parts.length > 0 ? `Parts:\n${parts.join("\n")}` : null,
			log.length > 0 ? `${heading}:\n${log.join("\n")}` : null,
		]
			.filter((section): section is string => Boolean(section))
			.join("\n\n")

	// The log goes first when the text is too long: the description and the parts are the answer, and a shortened log still says what was worked on.
	let log = entries
	let text = build(log)
	while (text.length > MAX_CHARS && log.length > 0) {
		log = log.slice(1)
		text = build(log)
	}
	return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS).trimEnd()}…` : text
}

/**
 * The maker-provided `Justification - …` columns for a submission.
 *
 * The Hackatime projects carry the week they were tracked in, because a project name on its own does not say which of the ten weeks it belonged to – and the reviewer's own reading of the hours depends on that.
 */
export function justificationValues(
	source: JustificationSource,
	opts: { eventStart: Date; phase: Phase; theme: Theme },
): JustificationValues {
	const week = scheduledWeekFor(opts.theme, opts.phase)
	const start = new Date(opts.eventStart.getTime() + (week - 1) * 7 * DAY_MS)
	const end = new Date(start.getTime() + 6 * DAY_MS)
	const projects = source.hackatimeProjects.map(name => `${name} (${ymd(start)} to ${ymd(end)})`)
	const features = specificTechnicalFeatures(source, opts.phase)
	return {
		...(source.hackatimeUserId ? { hackatimeId: source.hackatimeUserId } : {}),
		...(projects.length > 0 ? { hackatimeProjects: projects.join(", ") } : {}),
		...(source.lapseLinks.length > 0 ? { lapseLinks: source.lapseLinks.join(", ") } : {}),
		specificTechnicalFeatures: features || NO_FEATURES_RECORDED,
	}
}

/** What a reviewer needs to know when there is no Hackatime or Lapse evidence to follow. */
export interface AlternateTrackingSource {
	/** The hours those entries claim, as the row's `Hours spent (self reported)` states them. */
	claimedHours: number | null
	/** The manual journal entries behind the claim. A HACKATIME_TRACKED entry claims no time of its own and is not counted. */
	entryCount: number
	/** The reviewer's own explanation of how the entries account for the time, when one was recorded. */
	reviewerText: string | null
}

/**
 * The `Justification - Alternate Tracking Method` text.
 *
 * The pipeline has nothing to follow when a ship has neither Hackatime projects nor Lapse links, so this column is where a grant reviewer is told what the time actually rests on. The count and the claimed hours come from the submission itself; the reviewer's reasoning, when they left any, is appended because that is the part that says how the devlogs line up with the time rather than merely that they exist.
 *
 * Ari's current review sends the reviewer's reasoning as `audit_note`, which Half Life stores on the review; the legacy `time_evidence` and `hours_reasoning` fields are no longer collected, so the audit note is the best source available.
 */
export function alternateTrackingJustification(source: AlternateTrackingSource): string {
	const entries = Math.max(0, Math.floor(source.entryCount))
	const claimed = source.claimedHours === null ? "" : ` (${fmtHours(source.claimedHours)} claimed)`
	const method =
		entries > 0
			? `The time comes from ${entries} devlog ${entries === 1 ? "entry" : "entries"}${claimed}.`
			: "No devlog entries were recorded either."
	const reviewer = source.reviewerText?.trim()
	return `No Hackatime projects or Lapse timelapses were linked. ${method}${reviewer ? ` Reviewer's justification: ${reviewer}` : ""}`
}

/** One line of the parts list, or nothing for a line with no name on it. */
function partLine(part: JustificationPart): string | null {
	const name = part.name.trim()
	if (!name) return null
	const purpose = part.purpose?.trim() ?? ""
	const quantity = part.quantity > 1 ? ` (×${part.quantity})` : ""
	return `- ${name}${purpose ? `: ${purpose}` : ""}${quantity}`
}

/** One journal entry, as a line of the log, or nothing for an entry with no title. */
function sessionLine(session: JustificationSession, description: string): string | null {
	const title = session.title.trim()
	if (!title) return null
	const date = session.effectiveDate?.trim() || ymd(session.createdAt)
	const head = `- ${title}: ${fmtHours(session.hoursClaimed)}${date ? ` (${date})` : ""}`
	const excerpt = sessionExcerpt(session.content, description)
	return excerpt ? `${head}\n  ${excerpt}` : head
}

/**
 * The maker's own words for one sitting, or nothing when the entry only repeats what is already said.
 *
 * The warm-up import folds the description and the links that came with it into a single session's text, so quoting that session would only repeat the description above it.
 */
function sessionExcerpt(content: string | null, description: string): string | null {
	const text = content?.trim()
	if (!text) return null
	const kept = text
		.split("\n")
		.map(line => line.trim())
		.filter(line => line && !EVIDENCE_LINE.test(line))
		.join("\n")
		.replace(description, "")
		.trim()
	if (!kept) return null
	// An entry that opens with the description's own words is the description, not something new: the warm-up import folded it in, and a maker who has since edited their description leaves the old one behind.
	const opening = description.trim().slice(0, OPENING_CHARS)
	if (opening.length >= OPENING_CHARS && kept.startsWith(opening)) return null
	return kept.length > EXCERPT_CHARS ? `${kept.slice(0, EXCERPT_CHARS).trimEnd()}…` : kept
}
