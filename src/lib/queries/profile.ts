import "server-only"
import { PostStatus, Theme } from "@/app/generated/prisma/enums"
import { avatarUrl } from "@/lib/avatar"
import { getThemeDef } from "@/lib/config/program"
import { WEEK_META } from "@/lib/curriculum"
import { displayName } from "@/lib/display-name"
import { type FeedItem, getCreatorReels } from "@/lib/feed"
import { round2 } from "@/lib/money"
import db from "@/lib/prisma8"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"
import { type ProjectThumbnail, projectThumbnail } from "@/lib/thumbnail"
import { parseDbTimestamp } from "@/lib/time"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * A maker's profile: who they are, the projects they have started, and the reels they have posted.
 *
 * Display fields only, like Explore. A page about another person is where a careless `select` leaks the user table, so every column is named here and the avatar is the only thing built from a Slack id. The email, the encrypted address and the rest never leave the database.
 *
 * It is not the trail's store: that only holds the viewer's own projects, so everything on a profile comes from this one read.
 */

export interface ProfileProject {
	/** The scene colour behind a project that has no picture of its own. */
	accent: string
	entries: number
	/** Journalled hours – tracked entries contribute zero, as they do everywhere. */
	hours: number
	id: string
	/** The key `WeekPainting` knows the scene by, e.g. "PCB", "Breadboard computer". */
	painting: string
	/** The theme's name, "Warm Up" for a warm-up project. */
	themeLabel: string
	thumbnail: ProjectThumbnail | null
	title: string
	/** Warm-ups are not a week of the season; the card labels them differently. */
	warmup: boolean
}

export interface ProfileData {
	id: string
	image: string | null
	/** Whether the viewer is looking at their own profile. */
	isViewer: boolean
	/** When they joined the program, epoch ms. */
	joinedAt: number
	name: string
	projects: ProfileProject[]
	/** How many published reels they have in total, for the header. */
	reelCount: number
	/** Published reels, newest first, capped at `PROFILE_REELS`. */
	reels: FeedItem[]
	streak: number
}

/** How many reels a profile shows. Enough to be a body of work, not the whole archive. */
export const PROFILE_REELS = 24

export async function getProfile(userId: string, viewerId: string): Promise<ProfileData | null> {
	const [user, projects, reels, counts, settings] = await Promise.all([
		db.orm.public.User.whereUnique({ id: userId })
			.select("createdAt", "currentStreak", "displayName", "id", "image", "joinedProgramAt", "lastStreakDate", "name")
			.first(),
		db.orm.public.ThemeProject.where({ deletedAt: null, userId })
			.where(project => project.namedAt.isNotNull())
			.where(project => project.title.neq(""))
			.select("coverImageKey", "id", "theme", "title")
			.include("posts", posts =>
				posts
					.select("createdAt", "objectKey", "thumbnailKey")
					.where({ deletedAt: null })
					.where(post => post.status.eq(PostStatus.PUBLISHED)),
			)
			.include("workSessions", sessions =>
				sessions
					.select("content", "createdAt", "hoursApproved", "hoursClaimed", "hoursSource")
					.where({ deletedAt: null }),
			)
			.all(),
		getCreatorReels(userId, viewerId, PROFILE_REELS),
		db.orm.public.Post.where({ deletedAt: null, userId })
			.where(post => post.status.eq(PostStatus.PUBLISHED))
			.aggregate(a => ({ count: a.count() })),
		getProgramSettings(),
	])
	if (!user) return null

	const today = effectiveDateFor(new Date(), settings.programTimezone)

	// Later weeks first, warm-ups after them: a warm-up is not one of the season's weeks, and it comes before week 1.
	const ordered = projects.toSorted((a, b) => {
		const designWeekA = a.theme === Theme.WARMUP ? Number.MIN_SAFE_INTEGER : getThemeDef(a.theme).designWeek
		const designWeekB = b.theme === Theme.WARMUP ? Number.MIN_SAFE_INTEGER : getThemeDef(b.theme).designWeek
		return designWeekB - designWeekA
	})

	const shaped: ProfileProject[] = ordered.map(p => {
		const def = getThemeDef(p.theme)
		const warmup = p.theme === Theme.WARMUP
		const week = WEEK_META.find(w => w.id === def.designWeek)
		// A tracked entry's time arrives through its Hackatime link, so it adds nothing to the journalled number here either.
		const journal = p.workSessions.filter(s => s.hoursSource !== "HACKATIME_TRACKED")
		const hours = journal.reduce((n, s) => n + (s.hoursApproved ?? s.hoursClaimed), 0)
		return {
			accent: warmup ? "var(--color-violet-pale)" : (week?.accent ?? "var(--color-violet-pale)"),
			entries: p.workSessions.length,
			hours: round2(hours),
			id: p.id,
			painting: warmup ? "Warm Up" : (week?.theme ?? "PCB"),
			themeLabel: def.label,
			thumbnail: projectThumbnail(
				publicUrlFor(p.coverImageKey),
				p.workSessions.map(s => ({ content: s.content, createdAt: parseDbTimestamp(s.createdAt) })),
				p.posts.map(post => ({
					createdAt: parseDbTimestamp(post.createdAt),
					thumbnailUrl: publicUrlFor(post.thumbnailKey),
					videoUrl: publicUrlFor(post.objectKey),
				})),
			),
			title: p.title,
			warmup,
		}
	})

	return {
		id: user.id,
		image: avatarUrl(user),
		isViewer: user.id === viewerId,
		joinedAt: parseDbTimestamp(user.joinedProgramAt ?? user.createdAt).getTime(),
		name: displayName(user, "A maker"),
		projects: shaped,
		reelCount: counts.count,
		reels,
		// Expired against today, so a run that ended weeks ago reads 0 rather than the number it reached before it broke.
		streak: streakAsOf(user, today),
	}
}
