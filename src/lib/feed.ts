import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { PostKind, PostStatus, Role } from "@/app/generated/prisma/enums"
import { markReel } from "@/lib/analytics"
import { avatarUrl } from "@/lib/avatar"
import { displayName } from "@/lib/display-name"
import { HttpError } from "@/lib/errors"
import { cursorArgs, NEWEST_FIRST, pageResult } from "@/lib/pagination"
import prisma from "@/lib/prisma"
import { currentWeekNumber, getProgramSettings, isTimeZone, startOfDay } from "@/lib/program"
import { sanitize } from "@/lib/sanitize"
import { recomputeStreak } from "@/lib/streak"
import { isOwnedKey, publicUrlFor } from "@/lib/uploads/r2"

/**
 * The Doomscroller.
 *
 * Reels are not a social extra bolted on the side: the design file's checkpoint note makes an idea reel, a progress reel and a submission reel required steps of every week. That is why `Post.kind` exists and why this module is separate from journal sessions – a journal entry is evidence a reviewer reads to decide what someone is paid, a reel is something made to be watched, and the two must never be one query away from each other.
 *
 * Counts (`viewCount`, `likeCount`, `commentCount`) are denormalised onto the post and every writer updates the row and its count in the same transaction. The child rows remain the truth; the counts exist so a feed page is one query rather than three aggregates per card.
 */

/** Where reel uploads live in the bucket. Keys are validated against this. */
export const POST_UPLOAD_FOLDER = "posts"

export interface FeedAuthor {
	id: string
	name: string | null
	image: string | null
	streak: number
}

export interface FeedItem {
	id: string
	kind: PostKind
	caption: string
	videoUrl: string | null
	thumbnailUrl: string | null
	durationSeconds: number | null
	width: number | null
	height: number | null
	publishedAt: Date | null
	pinned: boolean
	author: FeedAuthor
	project: { id: string; theme: string; title: string } | null
	viewCount: number
	likeCount: number
	commentCount: number
	/** Whether the person asking has already liked it. */
	likedByMe: boolean
}

const feedInclude = {
	user: {
		select: { id: true, name: true, displayName: true, image: true, slackId: true, currentStreak: true },
	},
	themeProject: { select: { id: true, theme: true, title: true, deletedAt: true } },
} satisfies Prisma.PostInclude

type PostWithAuthor = Prisma.PostGetPayload<{ include: typeof feedInclude }>

function toFeedItem(post: PostWithAuthor, likedPostIds: ReadonlySet<string>): FeedItem {
	return {
		id: post.id,
		kind: post.kind,
		caption: post.caption,
		// Keys are stored, never URLs, so the bucket or CDN can move without rewriting a single row. The URL is minted here, at read time.
		videoUrl: publicUrlFor(post.objectKey),
		thumbnailUrl: publicUrlFor(post.thumbnailKey),
		durationSeconds: post.durationSeconds,
		width: post.width,
		height: post.height,
		publishedAt: post.publishedAt,
		pinned: post.pinnedAt !== null,
		author: {
			id: post.user.id,
			name: displayName(post.user),
			image: avatarUrl(post.user),
			streak: post.user.currentStreak,
		},
		// A reel outlives a deleted project, but stops pointing at it.
		project:
			post.themeProject && !post.themeProject.deletedAt
				? {
						id: post.themeProject.id,
						theme: post.themeProject.theme,
						title: post.themeProject.title,
					}
				: null,
		viewCount: post.viewCount,
		likeCount: post.likeCount,
		commentCount: post.commentCount,
		likedByMe: likedPostIds.has(post.id),
	}
}

/**
 * Only PUBLISHED posts, and never a soft-deleted one.
 *
 * Defined once and reused by every read path. A feed filter that has to be rewritten at each call site is a filter that will eventually be written wrong at one of them, and the failure mode is a hidden post reappearing.
 */
const visible: Prisma.PostWhereInput = {
	status: PostStatus.PUBLISHED,
	deletedAt: null,
}

export interface FeedPage {
	items: FeedItem[]
	nextCursor: string | null
	/**
	 * What goes above the paged rows, on the first page only: any reel an admin posted today in the viewer's timezone, newest first.
	 */
	leading: FeedItem[]
}

/**
 * One page of the feed, newest first, announcements included.
 *
 * An admin's reel from today leads it, so it is the first thing everyone sees that day, whether it was posted as an announcement or as an ordinary reel. From the next day it is back in its place by date, like any other. "Today" is the viewer's own day, from the timezone their browser sends: one posted late at night in New York is still today's for someone waking up in Delhi. A missing or unknown zone falls back to the program's.
 *
 * The leading reels are returned as their own list rather than spliced into the paged rows. Paginating a cursor across two different orderings is how a feed starts skipping or repeating items – the set is small, bounded, and only needed on the first page.
 */
export async function getFeed(
	viewerId: string,
	opts: { cursor?: string; limit: number; timeZone?: string },
): Promise<FeedPage> {
	const rows = await prisma.post.findMany({
		where: visible,
		include: feedInclude,
		orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
		...cursorArgs(opts.cursor, opts.limit),
	})

	let leading: typeof rows = []
	if (!opts.cursor) {
		const timeZone =
			opts.timeZone && isTimeZone(opts.timeZone) ? opts.timeZone : (await getProgramSettings()).programTimezone
		leading = await prisma.post.findMany({
			where: {
				...visible,
				publishedAt: { gte: startOfDay(new Date(), timeZone) },
				user: { roles: { some: { role: Role.ADMIN } } },
			},
			include: feedInclude,
			orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
			take: 5,
		})
	}

	// Each reel once: the leading ones are taken out of the page below them. A later page can still carry one, which the client drops as already seen.
	const leadIds = new Set(leading.map((p) => p.id))
	const page = pageResult(rows, opts.limit)
	const pageItems = page.items.filter((p) => !leadIds.has(p.id))
	const all = [...leading, ...pageItems]

	// One query for the viewer's likes across the whole page, rather than a correlated exists() per row.
	const liked = all.length
		? await prisma.postLike.findMany({
				where: { userId: viewerId, postId: { in: all.map((p) => p.id) } },
				select: { postId: true },
			})
		: []
	const likedIds = new Set(liked.map((l) => l.postId))

	return {
		items: pageItems.map((p) => toFeedItem(p, likedIds)),
		nextCursor: page.nextCursor,
		leading: leading.map((p) => toFeedItem(p, likedIds)),
	}
}

/**
 * One maker's own published reels, newest first, for their profile.
 *
 * The same `visible` filter and the same mapper as the feed, on purpose: a reel a moderator hid, or the author deleted, is not on their profile either, and whether the viewer has liked it is answered the way the feed answers it.
 */
export async function getCreatorReels(creatorId: string, viewerId: string, limit = 24): Promise<FeedItem[]> {
	const rows = await prisma.post.findMany({
		where: { ...visible, userId: creatorId },
		include: feedInclude,
		orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
		take: limit,
	})
	if (rows.length === 0) return []

	// One query for the viewer's likes across the whole set, exactly as the feed.
	const liked = await prisma.postLike.findMany({
		where: { userId: viewerId, postId: { in: rows.map((p) => p.id) } },
		select: { postId: true },
	})
	const likedIds = new Set(liked.map((l) => l.postId))
	return rows.map((p) => toFeedItem(p, likedIds))
}

export interface CreatePostInput {
	userId: string
	kind: PostKind
	caption: string
	objectKey: string
	thumbnailKey?: string | null
	themeProjectId?: string | null
	/** The trail node this reel answers, e.g. "w3-reel-2". Null off the trail. */
	checkpointKey?: string | null
	contentType?: string | null
	byteSize?: number | null
	durationSeconds?: number | null
	width?: number | null
	height?: number | null
	/** True when the author holds MANAGE_FEED. Only they may announce. */
	canManageFeed: boolean
}

/**
 * An object key must live under this user's own prefix.
 *
 * `/api/upload` builds keys as `posts/<userId>/<uuid>.<ext>`, but the key travels through the browser between the upload and this call, so the server has to check it rather than trust it. Without this, a post can be created pointing at somebody else's object – or at a key outside the posts folder entirely.
 */
function assertOwnedKey(userId: string, key: string, field: string): void {
	// Ownership plus the folder: a reel's video has to be in the posts folder, so a key that is genuinely yours but was uploaded as session evidence cannot be re-filed as a reel.
	if (!isOwnedKey(userId, key) || !key.startsWith(`${POST_UPLOAD_FOLDER}/`)) {
		throw new HttpError("VALIDATION_FAILED", `That ${field} is not one of your uploads`)
	}
}

export async function createPost(input: CreatePostInput): Promise<FeedItem> {
	if (input.kind === PostKind.ANNOUNCEMENT && !input.canManageFeed)
		throw new HttpError("FORBIDDEN", "Only the Half Life team can post announcements")

	assertOwnedKey(input.userId, input.objectKey, "video")
	if (input.thumbnailKey) assertOwnedKey(input.userId, input.thumbnailKey, "thumbnail")

	if (input.themeProjectId) {
		// A reel can be attached to a project, but only to one of yours – otherwise a reel could be filed against someone else's submission.
		const owned = await prisma.themeProject.findFirst({
			where: { id: input.themeProjectId, userId: input.userId, deletedAt: null },
			select: { id: true },
		})
		if (!owned) throw new HttpError("NOT_FOUND", "Project not found")
	}

	const caption = sanitize(input.caption)
	const weekNumber = await currentWeekNumber()

	// The reel and the streak day it earns land together: a rolled-back post must not leave a day behind, exactly as a rolled-back devlog must not.
	const post = await prisma.$transaction(async (tx) => {
		const created = await tx.post.create({
			data: {
				userId: input.userId,
				themeProjectId: input.themeProjectId ?? null,
				checkpointKey: input.checkpointKey ?? null,
				kind: input.kind,
				caption,
				objectKey: input.objectKey,
				thumbnailKey: input.thumbnailKey ?? null,
				contentType: input.contentType ?? null,
				byteSize: input.byteSize ?? null,
				durationSeconds: input.durationSeconds ?? null,
				width: input.width ?? null,
				height: input.height ?? null,
				weekNumber,
				// There is no transcoding step yet: the file is already in R2 by the time this runs, so the post is playable immediately. PROCESSING stays in the enum for when a pipeline lands and the thumbnail arrives later.
				status: PostStatus.PUBLISHED,
				publishedAt: new Date(),
				...(input.kind === PostKind.ANNOUNCEMENT ? { pinnedAt: new Date() } : {}),
			},
			include: feedInclude,
		})

		// A participant's own reel, not a staff announcement.
		if (input.kind !== PostKind.ANNOUNCEMENT) await recomputeStreak(tx, input.userId)

		return created
	})

	if (input.kind !== PostKind.ANNOUNCEMENT) await markReel(input.userId, post.createdAt)

	return toFeedItem(post, new Set())
}

/**
 * Record that someone watched a reel.
 *
 * The unique key does the work: a repeat view is a failed insert, so the count only moves when a genuinely new viewer arrives. This matters because the program pays prizes on virality – a number anyone can inflate by refreshing is a number that decides who gets a drawing tablet.
 */
export async function recordView(postId: string, userId: string): Promise<number> {
	return prisma.$transaction(async (tx) => {
		// Only a live, published reel counts. Without this, views keep accruing on a hidden or deleted post, and the virality number those prizes rest on could be moved for a reel that is out of the feed.
		const post = await tx.post.findFirst({ where: { id: postId, ...visible }, select: { id: true } })
		if (!post) throw new HttpError("NOT_FOUND", "Post not found")

		const { count } = await tx.postView.createMany({
			data: [{ postId, userId }],
			skipDuplicates: true,
		})
		if (count === 0) {
			const existing = await tx.post.findUnique({
				where: { id: postId },
				select: { viewCount: true },
			})
			return existing?.viewCount ?? 0
		}
		const updated = await tx.post.update({
			where: { id: postId },
			data: { viewCount: { increment: count } },
			select: { viewCount: true },
		})
		return updated.viewCount
	})
}

/**
 * Like or unlike. Explicitly stated rather than toggled: a toggle sent twice by an impatient double-tap ends in whichever state the race landed on, and the client always knows which one it means.
 */
export async function setLike(
	postId: string,
	userId: string,
	liked: boolean,
): Promise<{ likeCount: number; likedByMe: boolean }> {
	return prisma.$transaction(async (tx) => {
		const post = await tx.post.findFirst({ where: { id: postId, ...visible }, select: { id: true } })
		if (!post) throw new HttpError("NOT_FOUND", "Post not found")

		const delta = liked
			? (await tx.postLike.createMany({ data: [{ postId, userId }], skipDuplicates: true })).count
			: -(await tx.postLike.deleteMany({ where: { postId, userId } })).count

		if (delta === 0) {
			const current = await tx.post.findUniqueOrThrow({
				where: { id: postId },
				select: { likeCount: true },
			})
			return { likeCount: current.likeCount, likedByMe: liked }
		}

		const updated = await tx.post.update({
			where: { id: postId },
			data: { likeCount: { increment: delta } },
			select: { likeCount: true },
		})
		return { likeCount: updated.likeCount, likedByMe: liked }
	})
}

export interface CommentView {
	id: string
	body: string
	createdAt: Date
	author: { id: string; name: string | null; image: string | null }
	mine: boolean
}

export async function getComments(
	postId: string,
	viewerId: string,
	opts: { cursor?: string; limit: number },
): Promise<{ items: CommentView[]; nextCursor: string | null }> {
	// A hidden or deleted post's comments are not readable by id. The filter on the comments themselves is not enough – the parent has to be visible too.
	const post = await prisma.post.findFirst({ where: { id: postId, ...visible }, select: { id: true } })
	if (!post) throw new HttpError("NOT_FOUND", "Post not found")

	// Newest first, like every other conversation on the platform. The thread reads top-down from what just happened, and "show older comments" walks the cursor further back rather than forward – so the order and the affordance name the same direction.
	const rows = await prisma.postComment.findMany({
		where: { postId, deletedAt: null, hiddenAt: null },
		include: { user: { select: { id: true, name: true, displayName: true, image: true, slackId: true } } },
		orderBy: [...NEWEST_FIRST],
		...cursorArgs(opts.cursor, opts.limit),
	})
	const page = pageResult(rows, opts.limit)
	return {
		items: page.items.map((c) => ({
			id: c.id,
			body: c.body,
			createdAt: c.createdAt,
			author: { id: c.user.id, name: displayName(c.user), image: avatarUrl(c.user) },
			mine: c.user.id === viewerId,
		})),
		nextCursor: page.nextCursor,
	}
}

export async function addComment(postId: string, userId: string, body: string): Promise<CommentView> {
	const clean = sanitize(body)
	if (!clean) throw new HttpError("VALIDATION_FAILED", "Say something")

	return prisma.$transaction(async (tx) => {
		const post = await tx.post.findFirst({ where: { id: postId, ...visible }, select: { id: true } })
		if (!post) throw new HttpError("NOT_FOUND", "Post not found")

		const comment = await tx.postComment.create({
			data: { postId, userId, body: clean },
			include: { user: { select: { id: true, name: true, displayName: true, image: true, slackId: true } } },
		})
		await tx.post.update({ where: { id: postId }, data: { commentCount: { increment: 1 } } })

		return {
			id: comment.id,
			body: comment.body,
			createdAt: comment.createdAt,
			author: { id: comment.user.id, name: displayName(comment.user), image: avatarUrl(comment.user) },
			mine: true,
		}
	})
}

/** Delete your own comment. Moderators use `hideComment` instead. */
export async function deleteOwnComment(commentId: string, userId: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		// `hiddenAt: null` too: a moderator-hidden comment already had its decrement when it was hidden, so letting the owner delete it as well would take the count down a second time and could drive it negative.
		const { count } = await tx.postComment.updateMany({
			where: { id: commentId, userId, deletedAt: null, hiddenAt: null },
			data: { deletedAt: new Date() },
		})
		if (count === 0) throw new HttpError("NOT_FOUND", "Comment not found")
		const comment = await tx.postComment.findUniqueOrThrow({
			where: { id: commentId },
			select: { postId: true },
		})
		await tx.post.update({
			where: { id: comment.postId },
			data: { commentCount: { decrement: count } },
		})
	})
}

/** Soft-delete your own reel. */
export async function deleteOwnPost(postId: string, userId: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		const { count } = await tx.post.updateMany({
			where: { id: postId, userId, deletedAt: null },
			data: { deletedAt: new Date(), status: PostStatus.REMOVED },
		})
		if (count === 0) throw new HttpError("NOT_FOUND", "Post not found")
		// Deleting the only reel on a day removes that day from the run, so the streak is recomputed with it – same rule as deleting a devlog.
		await recomputeStreak(tx, userId)
	})
}

// ─── Moderation ──────────────────────────────────────────────────────────────

export async function hidePost(postId: string, moderatorId: string, reason: string): Promise<void> {
	const { count } = await prisma.post.updateMany({
		where: { id: postId, deletedAt: null },
		data: {
			status: PostStatus.HIDDEN,
			hiddenAt: new Date(),
			hiddenById: moderatorId,
			hiddenReason: sanitize(reason),
		},
	})
	if (count === 0) throw new HttpError("NOT_FOUND", "Post not found")
}

export async function restorePost(postId: string): Promise<void> {
	const { count } = await prisma.post.updateMany({
		where: { id: postId, deletedAt: null, status: PostStatus.HIDDEN },
		data: { status: PostStatus.PUBLISHED, hiddenAt: null, hiddenById: null, hiddenReason: null },
	})
	if (count === 0) throw new HttpError("NOT_FOUND", "Post not found")
}

export async function hideComment(commentId: string, moderatorId: string, reason: string): Promise<void> {
	await prisma.$transaction(async (tx) => {
		const { count } = await tx.postComment.updateMany({
			where: { id: commentId, hiddenAt: null, deletedAt: null },
			data: { hiddenAt: new Date(), hiddenById: moderatorId, hiddenReason: sanitize(reason) },
		})
		if (count === 0) throw new HttpError("NOT_FOUND", "Comment not found")
		const comment = await tx.postComment.findUniqueOrThrow({
			where: { id: commentId },
			select: { postId: true },
		})
		// A hidden comment is out of the feed, so it is out of the count too.
		await tx.post.update({
			where: { id: comment.postId },
			data: { commentCount: { decrement: count } },
		})
	})
}

export { PostKind, PostStatus }
