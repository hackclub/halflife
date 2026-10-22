import { fmtHours } from "@/lib/numbers"
import "server-only"
import { Phase, type Theme } from "@/app/generated/prisma/enums"
import { scheduledWeekFor } from "@/lib/config/program"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * The `Justification - …` columns of a submission row, and the text behind them.
 *
 * Three of the four are evidence the maker produced – their Hackatime identity, the Hackatime projects they tracked time in, and the timelapses they recorded – and the fourth is the account of what they actually built. They sit together on the row because the pipeline merges them into one justification blob (`Automation - Unified Justification`), where the evidence lands under `[HACKATIME]` and the account under `[SPECIFIC TECHNICAL FEATURES]`. A row with an empty account gives the pipeline an empty blob, which is why the fourth column is written from the maker's own work rather than left to the pipeline.
 *
 * Everything here is the maker's words: the description they wrote, the parts they listed, the journal entries they kept. Nothing a reviewer said is in it, because this is the maker's justification of their own hours, not the reviewer's note on them.
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
 * The values for the four columns, with a column left out entirely when we have nothing to put in it.
 *
 * A justification column is written with what we hold and left alone when we hold nothing. A blank written over one erases the only record of it, and for the pre-season rows Half Life imported, the Lapse links came from the form and were never handed to Postgres as timelapses – so a blank there would destroy evidence the base is the only place to find.
 */
export interface JustificationValues {
	hackatimeId?: string
	hackatimeProjects?: string
	lapseLinks?: string
	specificTechnicalFeatures?: string
}

/** The most text worth sending. A reviewer reads a summary of the work, not a journal dump. */
const MAX_CHARS = 8_000

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
 * The four `Justification - …` columns for a submission.
 *
 * The Hackatime projects carry the week they were tracked in, because a project name on its own does not say which of the ten weeks it belonged to – and the reviewer's own reading of the hours depends on that.
 */
export function justificationValues(
	source: JustificationSource,
	opts: { eventStart: Date; phase: Phase; theme: Theme },
): JustificationValues {
	const week = scheduledWeekFor(opts.theme, opts.phase)
	const start = new Date(opts.eventStart.getTime() + (week - 1) * 7 * 86_400_000)
	const end = new Date(start.getTime() + 6 * 86_400_000)
	const projects = source.hackatimeProjects.map(name => `${name} (${ymd(start)} to ${ymd(end)})`)
	const features = specificTechnicalFeatures(source, opts.phase)
	return {
		...(source.hackatimeUserId ? { hackatimeId: source.hackatimeUserId } : {}),
		...(projects.length > 0 ? { hackatimeProjects: projects.join(", ") } : {}),
		...(source.lapseLinks.length > 0 ? { lapseLinks: source.lapseLinks.join(", ") } : {}),
		...(features ? { specificTechnicalFeatures: features } : {}),
	}
}

/** One line of the parts list, or nothing for a line with no name on it. */
function partLine(part: JustificationPart): string | null {
	const name = part.name.trim()
	if (!name) return null
	const purpose = part.purpose?.trim() ?? ""
	const quantity = part.quantity > 1 ? ` (×${part.quantity})` : ""
	return `- ${name}${purpose ? ` – ${purpose}` : ""}${quantity}`
}

/** One journal entry, as a line of the log, or nothing for an entry with no title. */
function sessionLine(session: JustificationSession, description: string): string | null {
	const title = session.title.trim()
	if (!title) return null
	const date = session.effectiveDate?.trim() || ymd(session.createdAt)
	const head = `- ${title} – ${fmtHours(session.hoursClaimed)}${date ? ` (${date})` : ""}`
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
