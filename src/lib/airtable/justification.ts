import { fmtHours } from "@/lib/numbers"
import { DAY_MS } from "@/lib/time"
import "server-only"
import { scheduledWeekFor } from "@/lib/config/program"
import type { Phase, Theme } from "@/lib/enums"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * The `Justification - …` columns of a submission row, and the text behind them.
 *
 * Four are the evidence the maker's work produced – their Hackatime identity, the Hackatime projects they tracked time in, the timelapses they recorded, and, only when there is neither Hackatime nor Lapse evidence to follow, the devlog method the hours rest on. A sixth is the reviewer's own account of what the project has that accounts for the hours – Ari's `technical_features`, written verbatim. The pipeline merges those columns into one blob (`Automation - Unified Justification`). No journal text is copied into any of them: a decision's maker-facing feedback lives in the Loops status columns, and the journal dump this used to quote was never the reviewer's words anyway.
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
 * The reviewer's technical features are never in here: they arrive with the decision, so the decision mirror writes them (see `reviewerTechnicalFeaturesCell`), and a column nobody has decided on yet simply holds nothing for it.
 *
 * `alternateTracking` is filled only when there is no Hackatime or Lapse evidence to point at. See `alternateTrackingJustification` for what it says and when.
 */
export interface JustificationValues {
	alternateTracking?: string
	hackatimeId?: string
	hackatimeProjects?: string
	lapseLinks?: string
}

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
	return {
		...(source.hackatimeUserId ? { hackatimeId: source.hackatimeUserId } : {}),
		...(projects.length > 0 ? { hackatimeProjects: projects.join(", ") } : {}),
		...(source.lapseLinks.length > 0 ? { lapseLinks: source.lapseLinks.join(", ") } : {}),
	}
}

/** What a reviewer needs to know when there is no Hackatime or Lapse evidence to follow. */
export interface AlternateTrackingSource {
	/** The hours those entries claim, as the row's `Hours spent (self reported)` states them. */
	claimedHours: number | null
	/** The manual journal entries behind the claim. A HACKATIME_TRACKED entry claims no time of its own and is not counted. */
	entryCount: number
}

/**
 * The `Justification - Alternate Tracking Method` text.
 *
 * The pipeline has nothing to follow when a ship has neither Hackatime projects nor Lapse links, so this column is where a grant reviewer is told what the time actually rests on. The count and the claimed hours come from the submission itself. The reviewer's technical features are not part of this: they describe the work rather than the tracking method, and belong in `Justification - Specific Technical Features` (see `reviewerTechnicalFeaturesCell`).
 */
export function alternateTrackingJustification(source: AlternateTrackingSource): string {
	const entries = Math.max(0, Math.floor(source.entryCount))
	const claimed = source.claimedHours === null ? "" : ` (${fmtHours(source.claimedHours)} claimed)`
	const method =
		entries > 0
			? `The time comes from ${entries} devlog ${entries === 1 ? "entry" : "entries"}${claimed}.`
			: "No devlog entries were recorded either."
	return `No Hackatime projects or Lapse timelapses were linked. ${method}`
}

/**
 * The `Justification - Specific Technical Features` cell: Ari's `review.justification.technical_features`, the
 * reviewer's own account of what the project has that accounts for the hours – and nothing else. It replaced a
 * cell that began as the maker's description, parts list and every journal entry, which made the reviewer's words
 * indistinguishable from the maker's journal.
 */
export function reviewerTechnicalFeaturesCell(reviewerText: string | null): string {
	return reviewerText?.trim() ?? ""
}
