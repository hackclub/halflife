import "server-only"
import type { AriShipInput } from "@hackclub/ari"
import { ariExternalId } from "@/lib/ari-id"
import { getThemeDef, WARMUP_THEME } from "@/lib/config/program"
import { getTier, projectTierId } from "@/lib/config/tiers"
import { HoursSource, Phase, PhaseStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { getHoursBreakdown } from "@/lib/hours"
import { lapseTimelapseUrl } from "@/lib/lapse"
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
	claimed_seconds: number
	hackatime_seconds: number
	journal_seconds: number
	timelapse_seconds: number
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
 * The minutes a journal entry contributes to Ari, net of the recordings attached to it.
 *
 * Ari adds its time sources together: a journal entry's minutes and the duration of every Lapse clip it pulls for the ship's Hackatime projects. A clip attached to an entry is a recording *of* that sitting, so sending the entry's full claim as well counts the same work twice – the maker who logged 7h53 and recorded 7h53 was shown as 17h on Ari. The recorded part is taken off the claim here, floored at zero: what the clip does not cover is still the maker's own figure. Ari counts a clip only when it is a Lapse recording under one of the projects this ship names, so an R2 upload or a clip tracked under another project is evidence only and stays in the claim.
 *
 * A HACKATIME_TRACKED entry contributes nothing: its minutes arrive through the project link, which Ari dedupes against the same clips itself.
 */
export function journalMinutes(session: JournalTimeSource, countedProjects: ReadonlySet<string>): number {
	if (session.hoursSource === HoursSource.HACKATIME_TRACKED) return 0
	const claimedSeconds = Math.max(0, Math.round(session.hoursClaimed * 60 * 60))
	const recordedSeconds = session.timelapses.reduce((sum, t) => {
		if (t.provider !== "lapse" || !t.externalId || !t.hackatimeProject) return sum
		if (!countedProjects.has(t.hackatimeProject)) return sum
		return sum + Math.max(0, Math.round(t.coveredSeconds ?? 0))
	}, 0)
	return Math.min(1440, Math.round(Math.max(0, claimedSeconds - recordedSeconds) / 60))
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

/** The exact Ari payload, with the nested Review-only meta removed. */
export function toAriShipInput(input: ReviewShipInput): AriShipInput {
	return {
		...input,
		meta: {
			phase: input.meta.phase,
			program: input.meta.program,
			requested_tier: input.meta.requested_tier,
			submission_notes: input.meta.submission_notes,
			theme: input.meta.theme,
			week: input.meta.week,
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
			submissions.orderBy(submission => submission.createdAt.desc()).select("id", "notes", "phase", "resolvedAt"),
		)
		.include("user", user => user.select("email", "hackatimeUserId", "name", "slackId"))
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

	const journals = project.workSessions.slice(-200).map(session => {
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
		return Object.assign(
			{
				// `createdAt` is a Prisma 8 `TimestampString`, so it reads as `2026-10-22 14:25:05.757` – a space where the `T` belongs and no zone. The provider validates `journals[].at` as a date string and refuses that form, so convert it to a real Date and let JSON send ISO text.
				at: parseDbTimestamp(session.createdAt),
				// A HACKATIME_TRACKED entry contributes no time here – its minutes arrive through hackatime_projects – but it is still evidence the reviewer should see. A clip the provider counts is taken off the claim so the same sitting is not counted twice (see journalMinutes).
				minutes: journalMinutes(session, countedProjects),
				text: body,
			},
			// Ari has no field for a journal's own attachments: its Lapse tile pulls clips per Hackatime project. Linking each recording in the entry keeps it attached to the journal it backs even when that pull has nothing to match (no Hackatime id, or a project Lapse never named), so a reviewer never opens an entry with no evidence in it.
			clips.length > 0
				? {
						markdown: [
							body,
							...clips.map((url, index) => `[Timelapse${clips.length > 1 ? ` ${index + 1}` : ""}](${url})`),
						].join("\n\n"),
					}
				: {},
		)
	})

	const phaseSubmissions = project.submissions.filter(s => s.phase === phase)
	const openSubmission = phaseSubmissions.find(s => s.resolvedAt === null) ?? phaseSubmissions[0] ?? null
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
				claimed_seconds: Math.round(hours.computedTotal * 3600),
				hackatime_seconds: Math.round(hours.hackatimeHours * 3600),
				journal_seconds: Math.round(hours.journalHours * 3600),
				timelapse_seconds: Math.round(hours.timelapseSeconds),
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
