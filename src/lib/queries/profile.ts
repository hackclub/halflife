import "server-only"
import { PostStatus, Theme } from "@/app/generated/prisma/enums"
import { avatarUrl } from "@/lib/avatar"
import { getThemeDef } from "@/lib/config/program"
import { WEEK_META } from "@/lib/curriculum"
import { displayName } from "@/lib/display-name"
import { type FeedItem, getCreatorReels } from "@/lib/feed"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { streakAsOf } from "@/lib/streak"
import { type ProjectThumbnail, projectThumbnail } from "@/lib/thumbnail"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * A maker's profile: who they are, the projects they have started, and the
 * reels they have posted.
 *
 * Display fields only, like Explore. A page about another person is where a
 * careless `select` leaks the user table, so every column is named here and the
 * avatar is the only thing built from a Slack id. The email, the encrypted
 * address and the rest never leave the database.
 *
 * It is not the trail's store: that only holds the viewer's own projects, so
 * everything on a profile comes from this one read.
 */

export interface ProfileProject {
	id: string
	title: string
	/** The theme's name, "Warm Up" for a warm-up project. */
	themeLabel: string
	/** The key `WeekPainting` knows the scene by, e.g. "PCB", "Breadboard computer". */
	painting: string
	/** The scene colour behind a project that has no picture of its own. */
	accent: string
	/** Warm-ups are not a week of the season; the card labels them differently. */
	warmup: boolean
	thumbnail: ProjectThumbnail | null
	/** Journalled hours – tracked entries contribute zero, as they do everywhere. */
	hours: number
	entries: number
}

export interface ProfileData {
	id: string
	name: string
	image: string | null
	streak: number
	/** When they joined the program, epoch ms. */
	joinedAt: number
	/** Whether the viewer is looking at their own profile. */
	isViewer: boolean
	projects: ProfileProject[]
	/** Published reels, newest first, capped at `PROFILE_REELS`. */
	reels: FeedItem[]
	/** How many published reels they have in total, for the header. */
	reelCount: number
}

/** How many reels a profile shows. Enough to be a body of work, not the whole archive. */
export const PROFILE_REELS = 24

export async function getProfile(userId: string, viewerId: string): Promise<ProfileData | null> {
	const [user, projects, reels, reelCount, settings] = await Promise.all([
		prisma.user.findUnique({
			where: { id: userId },
			select: {
				id: true,
				name: true,
				displayName: true,
				image: true,
				slackId: true,
				currentStreak: true,
				lastStreakDate: true,
				joinedProgramAt: true,
				createdAt: true,
			},
		}),
		prisma.themeProject.findMany({
			// A project nobody has named is a placeholder made at sign-up, not one
			// to show, the same rule the project page applies.
			where: { userId, deletedAt: null, namedAt: { not: null }, title: { not: "" } },
			select: {
				id: true,
				title: true,
				theme: true,
				coverImageKey: true,
				workSessions: {
					where: { deletedAt: null },
					select: {
						content: true,
						hoursClaimed: true,
						hoursApproved: true,
						hoursSource: true,
						createdAt: true,
					},
				},
				posts: {
					where: { deletedAt: null, status: PostStatus.PUBLISHED },
					select: { createdAt: true, thumbnailKey: true, objectKey: true },
				},
			},
		}),
		getCreatorReels(userId, viewerId, PROFILE_REELS),
		prisma.post.count({ where: { userId, deletedAt: null, status: PostStatus.PUBLISHED } }),
		getProgramSettings(),
	])
	if (!user) return null

	const today = effectiveDateFor(new Date(), settings.programTimezone)

	// Season projects in week order, warm-ups after them.
	const ordered = [...projects].sort((a, b) => {
		const da = a.theme === Theme.WARMUP ? Number.MAX_SAFE_INTEGER : getThemeDef(a.theme).designWeek
		const db = b.theme === Theme.WARMUP ? Number.MAX_SAFE_INTEGER : getThemeDef(b.theme).designWeek
		return da - db
	})

	const shaped: ProfileProject[] = ordered.map((p) => {
		const def = getThemeDef(p.theme)
		const warmup = p.theme === Theme.WARMUP
		const week = WEEK_META.find((w) => w.id === def.designWeek)
		// A tracked entry's time arrives through its Hackatime link, so it adds
		// nothing to the journalled number here either.
		const journal = p.workSessions.filter((s) => s.hoursSource !== "HACKATIME_TRACKED")
		const hours = journal.reduce((n, s) => n + (s.hoursApproved ?? s.hoursClaimed), 0)
		return {
			id: p.id,
			title: p.title,
			themeLabel: def.label,
			painting: warmup ? "Warm Up" : (week?.theme ?? "PCB"),
			accent: warmup ? "var(--color-violet-pale)" : (week?.accent ?? "var(--color-violet-pale)"),
			warmup,
			thumbnail: projectThumbnail(
				publicUrlFor(p.coverImageKey),
				p.workSessions.map((s) => ({ createdAt: s.createdAt, content: s.content })),
				p.posts.map((post) => ({
					createdAt: post.createdAt,
					thumbnailUrl: publicUrlFor(post.thumbnailKey),
					videoUrl: publicUrlFor(post.objectKey),
				})),
			),
			hours: Math.round(hours * 100) / 100,
			entries: p.workSessions.length,
		}
	})

	return {
		id: user.id,
		name: displayName(user, "A maker"),
		image: avatarUrl(user),
		// Expired against today, so a run that ended weeks ago reads 0 rather
		// than the number it reached before it broke.
		streak: streakAsOf(user, today),
		joinedAt: (user.joinedProgramAt ?? user.createdAt).getTime(),
		isViewer: user.id === viewerId,
		projects: shaped,
		reels,
		reelCount,
	}
}
