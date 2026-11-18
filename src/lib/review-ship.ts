import "server-only"
import type { AriShipInput } from "@hackclub/ari"
import { ariExternalId } from "@/lib/ari-id"
import { getThemeDef, WARMUP_THEME } from "@/lib/config/program"
import { getTier, projectTierId } from "@/lib/config/tiers"
import { HoursSource, Phase, PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { getHoursBreakdown } from "@/lib/hours"
import { lapseTimelapseUrl, lookupTimelapses } from "@/lib/lapse"
import { statusFor } from "@/lib/phase"
import db from "@/lib/prisma8"
import { normalizeRepo } from "@/lib/repo"
import { sanitize } from "@/lib/sanitize"
import { DEFAULT_SESSION_TITLE } from "@/lib/schemas/session"
import { parseDbTimestamp } from "@/lib/time"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * The ship both review providers receive.
 *
 * Review accepts Ari's body plus nested `meta` context, which is the whole point of the new platform: the bill of materials, the hours breakdown and the project's prior decisions belong on the review screen rather than in another tab. The Ari SDK refuses nested meta, so `toAriShipInput` flattens this shape back to exactly the payload Ari takes today.
 */

export type ReviewEvidence = "commits" | "devlog" | "elapsed"

export interface ReviewJournal {
	at: Date
	markdown?: string
	minutes: number
	text: string
	/** Ire-only: the recordings backing this entry, for display and per-clip deflation. Stripped for Ari. */
	timelapses?: ReviewTimelapse[]
}

/** One recording backing a journal entry, in Ire's ingest shape. */
export interface ReviewTimelapse {
	coveredSeconds?: number
	externalId?: string
	provider?: string
	thumbnailUrl?: string
	url?: string
}

export interface ReviewMaker {
	email: string
	hackatime_id?: string
	name: string
	slack_id: string
}

export interface ReviewBomLine {
	link?: string | null
	name: string
	purpose?: string | null
	qty: number
	unit_usd: number
	vendor?: string | null
}

export interface ReviewHours {
	/** What Ari's own sum should come to once it adds the journals, the pool and Hackatime. */
	ari_expected_seconds?: number
	claimed_seconds: number
	hackatime_seconds: number
	journal_seconds: number
	/** How much of the foreign part was taken off this ship's journals, so Ari's total lands on Half Life's. */
	timelapse_carried_seconds?: number
	/** The part of the pool recorded for entries that are not on this ship – the load-bearing difference between the two totals. */
	timelapse_foreign_seconds?: number
	/**
	 * The recordings Ari will add to this ship, counted the way Ari counts them: every Lapse clip under a Hackatime project the ship names, from any week of any of the maker's projects. Evidence only for Half Life's own arithmetic, but the number a reviewer needs to explain why Ari's total is not the same as this one.
	 */
	timelapse_pool_seconds?: number
	timelapse_seconds: number
	/** Foreign seconds left over because the journals had no claim left to take them from. Non-zero means Ari will still read high by this much. */
	timelapse_unabsorbed_seconds?: number
}

export interface ReviewPriorReview {
	at?: string
	feedback?: string
	invalidated?: number
	result: string
	reviewer?: string
}

export interface ReviewShipMeta {
	bom: ReviewBomLine[]
	grant_cap_cents?: number
	hours: ReviewHours
	phase: "design" | "build"
	prior_reviews: ReviewPriorReview[]
	program: string
	requested_tier: number | null
	submission_notes: string | null
	theme: string
	week: number
}

export interface ReviewShipInput {
	demo_url?: string
	description: string
	evidence: ReviewEvidence[]
	external_id: string
	hackatime_projects?: string[]
	is_update?: boolean
	journals?: ReviewJournal[]
	maker: ReviewMaker
	meta: ReviewShipMeta
	repo_url: string
	/** When the maker handed this phase in (the open submission's creation time), as ISO 8601. Ire uses it for "time since submitted"; Ari does not take it. */
	submitted_at?: string
	thumbnail_url: string
	title: string
	track: "hardware"
	update_message?: string
}

export interface ReviewShipBundle {
	input: ReviewShipInput
	submissionId: string | null
}

function appUrl(): string {
	return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "")
}

/**
 * Ari requires a thumbnail. Prefer the project's own cover; fall back to the theme painting the participant already saw for that week, so a project without a cover is still reviewable rather than silently unsendable. A warm-up project has no theme painting – it was never part of the season – so it falls back to the programme's build artwork rather than a 404.
 */
function thumbnailFor(coverImageKey: string | null, slug: string): string {
	const cover = publicUrlFor(coverImageKey)
	if (cover) return cover
	return slug === WARMUP_THEME.slug ? `${appUrl()}/art/build.png` : `${appUrl()}/brand/themes/${slug}.png`
}

/** The build's closing reel, or null – hardware projects may omit a demo. */
async function buildDemoUrl(userId: string, buildWeek: number): Promise<string | null> {
	const reel = await db.orm.public.Post.where({
		checkpointKey: `w${buildWeek}-reel-submission`,
		deletedAt: null,
		userId,
	})
		.orderBy(post => post.createdAt.desc())
		.select("objectKey")
		.first()
	return publicUrlFor(reel?.objectKey ?? null)
}

/**
 * What a journal that is only recordings says to a reviewer.
 *
 * The journal form asks for words or timelapses, and an entry with only the latter used to reach Ari titled "Work session" with no text at all – indistinguishable from an entry where the maker forgot to write anything. Naming the situation and its clip count lets the reviewer judge the footage on its own instead of reading silence as a gap.
 */
const emptyTimelapseSession = (timelapses: number): string =>
	`[This is an empty work session with ${timelapses} timelapse${timelapses === 1 ? "" : "s"} attached.]`

/** One journal entry, as far as Ari's time accounting cares. */
export interface JournalTimeSource {
	hoursClaimed: number
	hoursSource: HoursSource
	timelapses: readonly {
		coveredSeconds: number | null
		externalId: string | null
		hackatimeProject: string | null
		provider: string
	}[]
}

/**
 * The minutes a journal entry contributes to Ari, split into its claim and the recordings netted off it.
 *
 * Ari adds its time sources together: a journal entry's minutes and the duration of every Lapse clip it pulls for the ship's Hackatime projects. A clip attached to an entry is a recording *of* that sitting, so sending the entry's full claim as well counts the same work twice – the maker who logged 7h53 and recorded 7h53 was shown as 17h on Ari. The recorded part is taken off the claim here, floored at zero: what the clip does not cover is still the maker's own figure. Ari counts a clip only when it is a Lapse recording under one of the projects this ship names, so an R2 upload or a clip tracked under another project is evidence only and stays in the claim.
 *
 * A HACKATIME_TRACKED entry contributes nothing: its minutes arrive through the project link, which Ari dedupes against the same clips itself.
 *
 * `projectOf` exists for the one case this file cannot answer from the stored row: a clip written before Lapse recorded which Hackatime project it was filmed under keeps `null`, while Ari pairs the clip by the project Lapse names *now*. Reading `null` as "not counted" there is exactly how a sitting got counted twice, so the caller resolves the project first and hands the answer in.
 */
export function journalTime(
	session: JournalTimeSource,
	countedProjects: ReadonlySet<string>,
	projectOf: (timelapse: JournalTimeSource["timelapses"][number]) => string | null = timelapse =>
		timelapse.hackatimeProject,
): { minutes: number; recordedSeconds: number } {
	if (session.hoursSource === HoursSource.HACKATIME_TRACKED) return { minutes: 0, recordedSeconds: 0 }
	const claimedSeconds = Math.max(0, Math.round(session.hoursClaimed * 60 * 60))
	const recordedSeconds = session.timelapses.reduce((sum, t) => {
		if (t.provider !== "lapse" || !t.externalId) return sum
		const project = projectOf(t)
		if (!project || !countedProjects.has(project)) return sum
		return sum + Math.max(0, Math.round(t.coveredSeconds ?? 0))
	}, 0)
	return {
		minutes: Math.min(1440, Math.round(Math.max(0, claimedSeconds - recordedSeconds) / 60)),
		recordedSeconds,
	}
}

/** The minutes alone, for callers that have no use for the split. */
export function journalMinutes(session: JournalTimeSource, countedProjects: ReadonlySet<string>): number {
	return journalTime(session, countedProjects).minutes
}

/**
 * Take the recordings a ship does not own off its journals, largest claim first.
 *
 * Ari counts every clip under a named Hackatime project, not only the ones attached to the entries it was sent. The bulk of that is usually this phase's own footage, which `journalTime` already nets per entry; what is left is footage from another week – a design hand-in carrying the build week's recordings, or the reverse. Left alone it is added wholesale to both ships, inflating each by the other's time.
 *
 * Journal minutes are the only negative lever a ship has, so the difference is moved off the entries that can spare it, biggest first, and what cannot be absorbed is reported rather than silently swallowed: Ari will read high by exactly that much. Nothing here decides what the maker is owed – Half Life's own hours never read the sent minutes – only what the reviewer sees on Ari's screen, which is the number they set the decision against.
 */
export function carryForeignClips(
	journals: readonly { minutes: number }[],
	foreignSeconds: number,
): { journals: { minutes: number }[]; carriedSeconds: number; unabsorbedSeconds: number } {
	const totalSeconds = journals.reduce((sum, journal) => sum + journal.minutes * 60, 0)
	const asked = Math.max(0, Math.round(foreignSeconds))
	const carried = Math.min(totalSeconds, asked)
	if (carried === 0)
		return {
			carriedSeconds: 0,
			journals: journals.map(journal => ({ minutes: journal.minutes })),
			unabsorbedSeconds: asked,
		}
	// Spread across every entry rather than emptying the largest: a hand-in whose biggest entry reads zero under its own write-up looks like a mistake to a reviewer, while a proportional trim leaves each entry's shape intact. Whole minutes are required, so the leftover goes to the entries that lost the most to rounding.
	const kept = totalSeconds - carried
	const exact = journals.map(journal => ((journal.minutes * 60) / totalSeconds) * kept)
	const seconds = exact.map(Math.floor)
	const order = exact
		.map((value, index) => ({ fraction: value - Math.floor(value), index }))
		.sort((a, b) => b.fraction - a.fraction)
	let leftover = kept - seconds.reduce((sum, value) => sum + value, 0)
	for (const entry of order) {
		if (leftover <= 0) break
		seconds[entry.index] = (seconds[entry.index] ?? 0) + 1
		leftover -= 1
	}
	return {
		carriedSeconds: carried,
		journals: seconds.map(total => ({ minutes: Math.floor(total / 60) })),
		unabsorbedSeconds: asked - carried,
	}
}

/** One Lapse clip as the maker's rows remember it, and as Lapse may correct it. */
interface OwnerClip {
	coveredSeconds: number
	externalId: string
	hackatimeProject: string | null
}

/**
 * Every Lapse clip this maker has recorded, across all their projects and phases.
 *
 * Ari's pool is not this phase's footage: it is every clip under a Hackatime project the ship names, whichever week it was filmed in. Reading the same set here is what lets the two totals be compared at all. Deleted sessions and projects count too, because deleting an entry removes Half Life's claim on that time but not the recording: Ari still pulls the clip, so leaving it out of the pool would put the over-count straight back on the next ship. A maker with no Lapse link simply has none.
 */
async function ownerClips(userId: string): Promise<OwnerClip[]> {
	const rows = await db.orm.public.SessionTimelapse.where(timelapse =>
		timelapse.workSession.some(session => session.themeProject.some(project => project.userId.eq(userId))),
	)
		.where(timelapse => timelapse.provider.eq("lapse"))
		.select("coveredSeconds", "externalId", "hackatimeProject")
		.all()
	return rows.flatMap(row =>
		row.externalId
			? [
					{
						coveredSeconds: row.coveredSeconds ?? 0,
						externalId: row.externalId,
						hackatimeProject: row.hackatimeProject,
					},
				]
			: [],
	)
}

/**
 * Which Hackatime project each clip was filmed under, preferring Lapse's own answer over the snapshot on the row.
 *
 * Only the rows with no project at all are asked about, so the usual ship reads nothing from Lapse. A failure leaves them unresolved, which reads as "not counted" and over-credits rather than under-credits – the same way the rest of the hours code treats an unknown.
 */
async function countClipProjects(userId: string, clips: readonly OwnerClip[]): Promise<Map<string, string | null>> {
	const missing = clips.filter(clip => !clip.hackatimeProject).map(clip => clip.externalId)
	if (missing.length === 0) return new Map()
	const asked = await lookupTimelapses(userId, missing)
	return new Map([...asked].map(([id, timelapse]) => [id, timelapse.hackatimeProject]))
}

/** What a ship's journals will say once every clip Ari counts has been taken off them. */
export interface AriClipPlan {
	/** How much of that was taken off this hand-in's journals. */
	carriedSeconds: number
	/** The part of the pool recorded for entries this hand-in does not carry. */
	foreignSeconds: number
	/** One entry's minutes, in the order the sessions were given: the figure the provider will read. */
	minutes: number[]
	/** The recordings under the named Hackatime projects, from every week of this maker's work. */
	poolSeconds: number
	/** What the journals could not absorb, so the provider will still read high by this much. */
	unabsorbedSeconds: number
}

/**
 * The minutes to send, and the arithmetic behind them.
 *
 * Ari pulls every clip under a named Hackatime project rather than the ones attached to the entries it was sent, so a hand-in carries its maker's recordings from other weeks unless the journals give up that much room. Both the sender and the review console need the same answer – one to send it, the other to say why Ari's total is not the one on screen – so the plan lives here rather than inside the sender.
 */
export async function planAriJournals(
	userId: string,
	sessions: readonly JournalTimeSource[],
	countedProjects: ReadonlySet<string>,
): Promise<AriClipPlan> {
	const makerClips = await ownerClips(userId)
	const clipProjects = await countClipProjects(userId, makerClips)
	const projectOfClip = (externalId: string | null | undefined, stored: string | null): string | null =>
		stored ?? (externalId ? (clipProjects.get(externalId) ?? null) : null)
	const poolSeconds = makerClips.reduce((sum, clip) => {
		const clipProject = projectOfClip(clip.externalId, clip.hackatimeProject)
		return clipProject && countedProjects.has(clipProject) ? sum + Math.max(0, Math.round(clip.coveredSeconds)) : sum
	}, 0)
	const times = sessions.map(session =>
		journalTime(session, countedProjects, timelapse => projectOfClip(timelapse.externalId, timelapse.hackatimeProject)),
	)
	const nettedSeconds = times.reduce((sum, time) => sum + time.recordedSeconds, 0)
	const foreignSeconds = Math.max(0, poolSeconds - nettedSeconds)
	const carried = carryForeignClips(times, foreignSeconds)
	return {
		carriedSeconds: carried.carriedSeconds,
		foreignSeconds,
		minutes: carried.journals.map(journal => journal.minutes),
		poolSeconds,
		unabsorbedSeconds: carried.unabsorbedSeconds,
	}
}

/**
 * Whether an entry carries no words of its own, leaving only the title column's "Work session" placeholder.
 *
 * Exported for the backfill that replaces ships already in Ari: a ship cannot be updated in place, so the script finds the entries whose text this rule rewrites.
 */
export function isWordlessJournal(content: string | null, title: string): boolean {
	const storedTitle = sanitize(title)
	return !sanitize(content ?? "") && (!storedTitle || storedTitle === DEFAULT_SESSION_TITLE)
}

/** The exact Ari payload, with the nested Review-only meta and Ire-only fields removed. */
export function toAriShipInput(input: ReviewShipInput): AriShipInput {
	const { submitted_at: _submittedAt, ...rest } = input
	return {
		...rest,
		meta: {
			phase: rest.meta.phase,
			program: rest.meta.program,
			requested_tier: rest.meta.requested_tier,
			submission_notes: rest.meta.submission_notes,
			theme: rest.meta.theme,
			week: rest.meta.week,
		},
	}
}

async function buildReviewShipInput(
	themeProjectId: string,
	phase: Phase,
	opts: { allowResolved?: boolean } = {},
): Promise<ReviewShipBundle> {
	const project = await db.orm.public.ThemeProject.whereUnique({ id: themeProjectId })
		.include("bomItems", items =>
			items
				.orderBy(item => item.sortOrder.asc())
				.select("link", "name", "purpose", "quantity", "unitCostUsd", "vendor"),
		)
		.include("hackatimeLinks", links => links.where({ phase }).select("hackatimeProject"))
		.include("submissions", submissions =>
			submissions
				.orderBy(submission => submission.createdAt.desc())
				.select("createdAt", "id", "notes", "phase", "resolvedAt"),
		)
		.include("user", owner => owner.select("email", "hackatimeUserId", "id", "name", "slackId"))
		.include("workSessions", sessions =>
			sessions
				.where({ deletedAt: null, phase })
				.orderBy(session => session.createdAt.asc())
				.select("content", "createdAt", "hoursClaimed", "hoursSource", "title")
				.include("timelapses", timelapse =>
					timelapse.select("coveredSeconds", "externalId", "hackatimeProject", "objectKey", "playbackUrl", "provider"),
				),
		)
		.first()
	if (!project?.user) throw new HttpError("NOT_FOUND", "Project not found")

	// A retry job snapshots what is pending and sends later; the maker can have unsubmitted in between. The row the decision would land on is gone, so sending would leave an untracked ship in the review queue.
	// The reviewed backfill builds ships whose phase has already been decided, so it opts out of the in-review guard.
	const phaseStatus = statusFor(project, phase)
	if (phaseStatus !== PhaseStatus.in_review && !opts.allowResolved)
		throw new HttpError("NOT_SUBMITTED", "This phase is no longer awaiting review, so there is no ship to send")

	const { user } = project
	if (!project.title.trim()) throw new HttpError("UNPROCESSABLE", "This project has no title to send to review")
	if (!project.githubRepo) throw new HttpError("UNPROCESSABLE", "This project has no repository link to send to review")
	if (!user.slackId)
		throw new HttpError("UNPROCESSABLE", "This account has no Slack ID, so review cannot be told who the maker is")

	// Ari validates `repo_url` as an absolute http(s) URL, and the stored link is not always one: the project form enforces that, but the warm-up importers write `githubRepo` straight from a spreadsheet cell, where a maker is as likely to have typed `github.com/me/thing` with the scheme left off. `normalizeRepo` is the same rule the repo field itself applies, so a link that would have saved fine had it been typed on the project page is sent rather than failing the whole ship – and one that will not parse is refused here, naming the link, instead of coming back from the provider as a bare field error that leaves the project retrying on the hour with nothing an operator can act on.
	const repoUrl = normalizeRepo(project.githubRepo).url
	if (!repoUrl)
		throw new HttpError(
			"UNPROCESSABLE",
			`This project's repo link is not a web address, so it cannot be sent to review: ${project.githubRepo}`,
		)

	const def = getThemeDef(project.theme)

	// Only projects the maker attached are named here: everything in `hackatime_projects` is time the review platform counts, and a recording's `hackatimeProject` is whatever Hackatime happened to be tracking when it was filmed, not a link the maker made to this entry. The recording still travels as evidence through the clip links in its journal below.
	const hackatimeProjects = [...new Set(project.hackatimeLinks.map(l => l.hackatimeProject))].slice(0, 50)
	const countedProjects = new Set(hackatimeProjects)

	const sent = project.workSessions.slice(-200)
	const plan = await planAriJournals(user.id, sent, countedProjects)
	const ariExpectedSeconds = plan.minutes.reduce((sum, minutes) => sum + minutes * 60, 0) + plan.poolSeconds

	const journals = sent.map((session, index) => {
		const clips = session.timelapses.flatMap(t => {
			const url =
				t.provider === "lapse" && t.externalId
					? lapseTimelapseUrl(t.externalId)
					: (t.playbackUrl ?? publicUrlFor(t.objectKey))
			return url ? [url] : []
		})
		// An entry can be a recording and nothing else: the maker attached a timelapse and logged the time without writing a word, so the stored title is the "Work session" placeholder. Sent as-is that reads as a blank entry to a reviewer, as if the work were missing rather than recorded, so say what the entry actually is – the clip links below are its evidence.
		const written = sanitize(session.content ?? "")
		const body =
			isWordlessJournal(session.content, session.title) && clips.length > 0
				? emptyTimelapseSession(clips.length)
				: written || sanitize(session.title) || "Journal entry"
		return {
			// `createdAt` is a Prisma 8 `TimestampString`, so it reads as `2026-10-22 14:25:05.757` – a space where the `T` belongs and no zone. The provider validates `journals[].at` as a date string and refuses that form, so convert it to a real Date and let JSON send ISO text.
			at: parseDbTimestamp(session.createdAt),
			// A HACKATIME_TRACKED entry contributes no time here – its minutes arrive through hackatime_projects – but it is still evidence the reviewer should see. A clip the provider counts is taken off the claim so the same sitting is not counted twice (see journalTime), and the second pass takes off footage recorded for another week, which Ari would otherwise add to this ship as well.
			minutes: plan.minutes[index] ?? 0,
			text: body,
			// Ari has no field for a journal's own attachments: its Lapse tile pulls clips per Hackatime project. Linking each recording in the entry keeps it attached to the journal it backs even when that pull has nothing to match (no Hackatime id, or a project Lapse never named), so a reviewer never opens an entry with no evidence in it.
			...(clips.length > 0
				? {
						markdown: [
							body,
							...clips.map((url, clipIndex) => `[Timelapse${clips.length > 1 ? ` ${clipIndex + 1}` : ""}](${url})`),
						].join("\n\n"),
					}
				: {}),
		}
	})

	const phaseSubmissions = project.submissions.filter(s => s.phase === phase)
	const openSubmission = phaseSubmissions.find(s => s.resolvedAt === null) ?? phaseSubmissions[0] ?? null
	const submittedAt = openSubmission ? parseDbTimestamp(openSubmission.createdAt).toISOString() : undefined
	const isUpdate = phaseSubmissions.some(s => s.resolvedAt !== null)
	const demoUrl = phase === Phase.BUILD ? await buildDemoUrl(project.userId, def.buildWeek) : null
	const hasTimelapse = project.workSessions.some(s => s.timelapses.length > 0)

	// The reviewer sees the same numbers the console would: computed journal and Hackatime hours, and the timelapse as evidence rather than an additive source. The submitted claim is the computed total, so a decision made with the default hours does not silently ignore the Hackatime half.
	const [hours, priorReviews] = await Promise.all([
		getHoursBreakdown(themeProjectId, phase, { live: false }),
		db.orm.public.SubmissionReview.where(review =>
			review.submission.some(submission => submission.themeProjectId.eq(themeProjectId)),
		)
			.orderBy(review => review.createdAt.desc())
			.limit(20)
			.select("createdAt", "feedback", "invalidated", "result", "reviewerEmail", "reviewerName")
			.all(),
	])

	const bom = project.bomItems.map(item => ({
		link: item.link,
		name: item.name,
		purpose: item.purpose,
		qty: item.quantity,
		unit_usd: item.unitCostUsd,
		vendor: item.vendor,
	}))

	const tier = getTier(projectTierId(project))
	const grantCapCents = phase === Phase.DESIGN && tier ? Math.round(tier.grantUsd * 100) : undefined

	const input: ReviewShipInput = {
		// Review rejects an empty description. Week one's onboarding allows one, and submissions made before that was enforced would otherwise fail every retry, so fall back to the title rather than throw: the title is always present and is a truer description than a placeholder would be.
		description: project.description?.trim() || project.title,
		external_id: ariExternalId(themeProjectId, phase),
		maker: {
			email: user.email,
			name: user.name?.trim() || user.email,
			slack_id: user.slackId,
			...(user.hackatimeUserId ? { hackatime_id: user.hackatimeUserId } : {}),
			// No `program_hours`: Half Life's time is exactly the journals and Hackatime projects below, which the provider counts itself. Reporting the same hours as program-provided time would make it count them twice.
		},
		repo_url: repoUrl,
		...(submittedAt ? { submitted_at: submittedAt } : {}),
		thumbnail_url: thumbnailFor(project.coverImageKey, def.slug),
		title: project.title,
		// Half Life is a hardware programme, so a demo video is optional.
		track: "hardware",
		...(demoUrl ? { demo_url: demoUrl } : {}),
		// Only ask the provider to check elapsed-time evidence when there is a timelapse.
		evidence: hasTimelapse ? ["commits", "devlog", "elapsed"] : ["commits", "devlog"],
		...(hackatimeProjects.length > 0 ? { hackatime_projects: hackatimeProjects } : {}),
		...(journals.length > 0 ? { journals } : {}),
		meta: {
			bom,
			...(grantCapCents === undefined ? {} : { grant_cap_cents: grantCapCents }),
			hours: {
				ari_expected_seconds: Math.round(ariExpectedSeconds + hours.hackatimeHours * 3600),
				claimed_seconds: Math.round(hours.computedTotal * 3600),
				hackatime_seconds: Math.round(hours.hackatimeHours * 3600),
				journal_seconds: Math.round(hours.journalHours * 3600),
				timelapse_carried_seconds: plan.carriedSeconds,
				timelapse_foreign_seconds: plan.foreignSeconds,
				timelapse_pool_seconds: plan.poolSeconds,
				timelapse_seconds: Math.round(hours.timelapseSeconds),
				timelapse_unabsorbed_seconds: plan.unabsorbedSeconds,
			},
			phase: phase === Phase.DESIGN ? "design" : "build",
			prior_reviews: priorReviews.map(review => {
				const item: ReviewPriorReview = {
					at: parseDbTimestamp(review.createdAt).toISOString(),
					feedback: review.feedback,
					invalidated: review.invalidated ? 1 : 0,
					result: review.result,
				}
				const reviewer = review.reviewerName ?? review.reviewerEmail
				if (reviewer) item.reviewer = reviewer
				return item
			}),
			program: "half-life",
			requested_tier: project.requestedTier ?? null,
			submission_notes: openSubmission?.notes ?? null,
			theme: def.slug,
			week: phase === Phase.DESIGN ? def.designWeek : def.buildWeek,
		},
		...(isUpdate ? { is_update: true, update_message: "Resubmitted after review" } : {}),
	}

	return { input, submissionId: openSubmission?.id ?? null }
}

export { buildReviewShipInput }
