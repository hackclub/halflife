import "server-only"
import { and, not } from "@prisma/orm-postgres/orm-client"
import { avatarUrl } from "@/lib/avatar"
import { participantThemeLabel } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import db from "@/lib/prisma8"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { DEFAULT_SESSION_TITLE } from "@/lib/schemas/session"
import { streakAsOf } from "@/lib/streak"
import { parseDbTimestamp } from "@/lib/time"

/**
 * The page that is about everyone else: Explore.
 *
 * ## What is shown, and what is not
 *
 * It is deliberately thin. A row carries a display name, an avatar, a project title and numbers – never an email, a location or anything under `encrypted*`. (The avatar URL embeds the author's Slack id, because that is how the image is fetched; that is an accepted exposure, not an oversight.) A page about other people is where a careless `select` leaks the whole user table, so this query names every column it wants rather than spreading a row.
 *
 * Object keys are deliberately NOT here. R2 serves them publicly, so a key is a capability to fetch that file – and the journal's photographs already ride inside the body as Markdown, which is the copy this page renders. Shipping the keys as well put every participant's session media into every other participant's page payload for nothing.
 *
 * Journal bodies are shown as written. Participants write them knowing a reviewer will read them, and the program already publishes reels to the Doomscroller, so the audience is peers either way – but it is a real choice and this is where it is made. Soft-deleted sessions and deleted projects are excluded, so removing an entry removes it here too.
 *
 * Empty entries are left out as well. A session whose writer left the entry blank is stored with the fallback title and no content, and it would otherwise render as a card carrying a byline and a title and nothing else. An entry that genuinely opens with that line has a body behind it, so it survives.
 */

export interface JournalRow {
	author: string
	authorId: string
	authorImage: string | null
	body: string
	/** YYYY-MM-DD in the program timezone – what the day grouping reads. */
	day: string
	id: string
	minutes: number
	project: string
	projectId: string
	streak: number
	when: string
}

const FEED_LIMIT = 60

export async function getJournalFeed(): Promise<JournalRow[]> {
	const [sessions, settings] = await Promise.all([
		db.orm.public.WorkSession.where({ deletedAt: null })
			.where(session => session.themeProject.some(project => project.deletedAt.isNull()))
			// `NOT` negates the pair, so an entry survives when it carries a body: a writer who really typed the fallback line as their opening has content behind the title, and is not caught here.
			.where(session => not(and(session.content.isNull(), session.title.eq(DEFAULT_SESSION_TITLE))))
			// The id breaks ties, so two entries saved in the same millisecond keep one order between loads.
			.orderBy([session => session.createdAt.desc(), session => session.id.desc()])
			.limit(FEED_LIMIT)
			.select("content", "createdAt", "effectiveDate", "hoursApproved", "hoursClaimed", "hoursSource", "id", "title")
			.include("themeProject", project =>
				project
					.select("id", "theme", "title")
					.include("user", user =>
						user.select("currentStreak", "displayName", "id", "image", "lastStreakDate", "name", "slackId"),
					),
			)
			.all(),
		getProgramSettings(),
	])

	const today = effectiveDateFor(new Date(), settings.programTimezone)

	return sessions.map(session => {
		const project = session.themeProject
		if (!project) throw new Error(`session ${session.id} has no project`)
		if (!project.user) throw new Error(`session ${session.id} has no author`)
		const createdAt = parseDbTimestamp(session.createdAt)
		return {
			author: displayName(project.user, "A maker"),
			authorId: project.user.id,
			authorImage: avatarUrl(project.user),
			body: session.content ?? session.title,
			day: session.effectiveDate ?? effectiveDateFor(createdAt, settings.programTimezone),
			id: session.id,
			// A tracked entry's time arrives (and is paid) through the Hackatime link, so advertising its claimed minutes here would show hours the paid totals deliberately exclude.
			minutes:
				session.hoursSource === "HACKATIME_TRACKED"
					? 0
					: Math.round((session.hoursApproved ?? session.hoursClaimed) * 60),
			project: project.title || participantThemeLabel(project.theme),
			projectId: project.id,
			// Expired against today, so a run that ended weeks ago reads 0 rather than the number it reached before it broke.
			streak: streakAsOf(project.user, today),
			when: createdAt.toISOString(),
		}
	})
}
