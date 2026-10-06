import "server-only"
import { avatarUrl } from "@/lib/avatar"
import { getThemeDef } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"

/**
 * The page that is about everyone else: Explore.
 *
 * ## What is shown, and what is not
 *
 * It is deliberately thin. A row carries a display name, an avatar, a project
 * title and numbers — never an email, a location or anything under
 * `encrypted*`. (The avatar URL embeds the author's Slack id, because that is
 * how the image is fetched; that is an accepted exposure, not an oversight.)
 * A page about other people is where a careless `select` leaks the whole user
 * table, so this query names every column it wants rather than spreading a row.
 *
 * Object keys are deliberately NOT here. R2 serves them publicly, so a key is
 * a capability to fetch that file — and the journal's photographs already ride
 * inside the body as Markdown, which is the copy this page renders. Shipping
 * the keys as well put every participant's session media into every other
 * participant's page payload for nothing.
 *
 * Journal bodies are shown as written. Participants write them knowing a
 * reviewer will read them, and the program already publishes reels to the
 * Doomscroller, so the audience is peers either way — but it is a real choice
 * and this is where it is made. Soft-deleted sessions and deleted projects are
 * excluded, so removing an entry removes it here too.
 */

export interface JournalRow {
	id: string
	author: string
	authorId: string
	authorImage: string | null
	streak: number
	projectId: string
	project: string
	body: string
	minutes: number
	/** YYYY-MM-DD in the program timezone — what the day grouping reads. */
	day: string
	when: string
}

const FEED_LIMIT = 60

export async function getJournalFeed(): Promise<JournalRow[]> {
	const [sessions, settings] = await Promise.all([
		prisma.workSession.findMany({
			where: { deletedAt: null, themeProject: { deletedAt: null } },
			// The id breaks ties, so two entries saved in the same millisecond keep
			// one order between loads.
			orderBy: [{ createdAt: "desc" }, { id: "desc" }],
			take: FEED_LIMIT,
			select: {
				id: true,
				content: true,
				title: true,
				hoursClaimed: true,
				hoursApproved: true,
				hoursSource: true,
				effectiveDate: true,
				createdAt: true,
				themeProject: {
					select: {
						id: true,
						title: true,
						theme: true,
						user: {
							select: {
								id: true,
								name: true,
								displayName: true,
								image: true,
								slackId: true,
								currentStreak: true,
								lastStreakDate: true,
							},
						},
					},
				},
			},
		}),
		getProgramSettings(),
	])

	const today = effectiveDateFor(new Date(), settings.programTimezone)

	return sessions.map((session) => {
		const project = session.themeProject
		return {
			id: session.id,
			author: displayName(project.user, "A maker"),
			authorId: project.user.id,
			authorImage: avatarUrl(project.user),
			// Expired against today, so a run that ended weeks ago reads 0 rather
			// than the number it reached before it broke.
			streak: streakAsOf(project.user, today),
			projectId: project.id,
			project: project.title || getThemeDef(project.theme).label,
			body: session.content ?? session.title,
			// A tracked entry's time arrives (and is paid) through the Hackatime
			// link, so advertising its claimed minutes here would show hours the
			// paid totals deliberately exclude.
			minutes:
				session.hoursSource === "HACKATIME_TRACKED"
					? 0
					: Math.round((session.hoursApproved ?? session.hoursClaimed) * 60),
			day: session.effectiveDate ?? effectiveDateFor(session.createdAt, settings.programTimezone),
			when: session.createdAt.toISOString(),
		}
	})
}
