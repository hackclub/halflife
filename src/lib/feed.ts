import "server-only"
import type { Models } from "@/app/generated/prisma8/contract.d"
import { markReel } from "@/lib/analytics"
import { avatarUrl } from "@/lib/avatar"
import { displayName } from "@/lib/display-name"
import { PostKind, PostStatus, Role } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import { decodeCursor, encodeCursor } from "@/lib/pagination"
import db, { type DbOrTx } from "@/lib/prisma8"
import { currentWeekNumber, getProgramSettings, isTimeZone, startOfDay } from "@/lib/program"
import { sanitize } from "@/lib/sanitize"
import { recomputeStreak } from "@/lib/streak"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"
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
	image: string | null
	name: string | null
	streak: number
}

export interface FeedItem {
	author: FeedAuthor
	caption: string
	commentCount: number
	durationSeconds: number | null
	height: number | null
	id: string
	kind: PostKind
	likeCount: number
	/** Whether the person asking has already liked it. */
	likedByMe: boolean
	pinned: boolean
	project: { id: string; theme: string; title: string } | null
	publishedAt: Date | null
	thumbnailUrl: string | null
	videoUrl: string | null
	viewCount: number
	width: number | null
}

/** One feed row as Prisma 8 reads it, with the author and project attached. Timestamps are PostgreSQL text until `toFeedItem` parses them. */
export interface PostWithAuthor {
	caption: string
	commentCount: number
	durationSeconds: number | null
	height: number | null
	id: string
	kind: Models.public_Post["kind"]
	likeCount: number
	objectKey: string
	pinnedAt: string | null
	publishedAt: string | null
	themeProject: { deletedAt: string | null; id: string; theme: string; title: string } | null
	thumbnailKey: string | null
	user: { currentStreak: number; displayName: string | null; id: string; image: string | null; name: string | null }
	viewCount: number
	width: number | null
}

function toFeedItem(post: PostWithAuthor, likedPostIds: ReadonlySet<string>): FeedItem {
	return {
		author: {
			id: post.user.id,
			image: avatarUrl(post.user),
			name: displayName(post.user),
			streak: post.user.currentStreak,
		},
		caption: post.caption,
		commentCount: post.commentCount,
		durationSeconds: post.durationSeconds,
		height: post.height,
		id: post.id,
		kind: post.kind,
		likeCount: post.likeCount,
		likedByMe: likedPostIds.has(post.id),
		pinned: post.pinnedAt !== null,
		// A reel outlives a deleted project, but stops pointing at it.
		project:
			post.themeProject && !post.themeProject.deletedAt
				? {
						id: post.themeProject.id,
						theme: post.themeProject.theme,
						title: post.themeProject.title,
					}
				: null,
		publishedAt: post.publishedAt === null ? null : parseDbTimestamp(post.publishedAt),
		thumbnailUrl: publicUrlFor(post.thumbnailKey),
		// Keys are stored, never URLs, so the bucket or CDN can move without rewriting a single row. The URL is minted here, at read time.
		videoUrl: publicUrlFor(post.objectKey),
		viewCount: post.viewCount,
		width: post.width,
	}
}

/**
 * Only PUBLISHED posts, and never a soft-deleted one.
 *
 * Defined once and reused by every read path. A feed filter that has to be rewritten at each call site is a filter that will eventually be written wrong at one of them, and the failure mode is a hidden post reappearing.
 */
const visible = () => ({ deletedAt: null, status: PostStatus.PUBLISHED }) as const

export interface FeedPage {
	items: FeedItem[]
	/**
	 * What goes above the paged rows, on the first page only: any reel an admin posted today in the viewer's timezone, newest first.
	 */
	leading: FeedItem[]
	nextCursor: string | null
}

/**
 * One page of the feed, newest first, announcements included.
 *
 * An admin's reel from today leads it, so it is the first thing everyone sees that day, whether it was posted as an announcement or as an ordinary reel. From the next day it is back in its place by date, like any other. "Today" is the viewer's own day, from the timezone their browser sends: one posted late at night in New York is still today's for someone waking up in Delhi. A missing or unknown zone falls back to the program's.
 *
 * The leading reels are returned as their own list rather than spliced into the paged rows. Paginating a cursor across two different orderings is how a feed starts skipping or repeating items – the set is small, bounded, and only needed on the first page.
 */
/** The author is required by the foreign key, so a missing one is a data-integrity error rather than a row to render without one. */
function withAuthor(row: Omit<PostWithAuthor, "user"> & { user: PostWithAuthor["user"] | null }): PostWithAuthor {
	if (!row.user) throw new Error(`post ${row.id} has no author`)
	return { ...row, user: row.user }
}

/** The feed's order: newest first by the moment a reel went up, with the id as the tiebreaker. Cursor pages carry both halves of that position, so a page boundary that falls between two reels posted in the same millisecond drops neither. */
function feedOrdered() {
	return db.orm.public.Post.where(visible())
		.select(
			"caption",
			"commentCount",
			"durationSeconds",
			"height",
			"id",
			"kind",
			"likeCount",
			"objectKey",
			"pinnedAt",
			"publishedAt",
			"thumbnailKey",
			"viewCount",
			"width",
		)
		.include("themeProject", project => project.select("deletedAt", "id", "theme", "title"))
		.include("user", user =>
			// No Slack id: nothing here renders it, and a selected column rides along in the RSC payload to every browser that opens the feed.
			user.select("currentStreak", "displayName", "id", "image", "name"),
		)
		.orderBy([post => post.publishedAt.desc(), post => post.id.desc()])
}

export async function getFeed(
	viewerId: string,
	opts: { cursor?: string; limit: number; timeZone?: string },
): Promise<FeedPage> {
	const position = opts.cursor === undefined ? null : decodeCursor(opts.cursor)
	const fetched = await (position?.at === undefined || position?.at === null
		? feedOrdered()
		: feedOrdered().cursor({
				id: position.id,
				publishedAt: position.at === null ? null : formatDbTimestamp(position.at),
			})
	)
		.limit(opts.limit + 1)
		.all()
	const rows = fetched.map(withAuthor)

	let leading: PostWithAuthor[] = []
	if (!opts.cursor) {
		const timeZone =
			opts.timeZone && isTimeZone(opts.timeZone) ? opts.timeZone : (await getProgramSettings()).programTimezone
		leading = (
			await feedOrdered()
				.where(post => post.publishedAt.gte(formatDbTimestamp(startOfDay(new Date(), timeZone))))
				.where(post => post.user.some(author => author.roles.some(userRole => userRole.role.eq(Role.ADMIN))))
				.limit(5)
				.all()
		).map(withAuthor)
	}

	// Each reel once: the leading ones are taken out of the page below them. A later page can still carry one, which the client drops as already seen.
	const leadIds = new Set(leading.map(p => p.id))
	const items = rows.slice(0, opts.limit)
	const last = items.at(-1)
	const pageItems = items.filter(p => !leadIds.has(p.id))
	const all = [...leading, ...pageItems]

	// One query for the viewer's likes across the whole page, rather than a correlated exists() per row.
	const liked =
		all.length > 0
			? await db.orm.public.PostLike.where(like => like.postId.in(all.map(p => p.id)))
					.where({ userId: viewerId })
					.select("postId")
					.all()
			: []
	const likedIds = new Set(liked.map(l => l.postId))

	return {
		items: pageItems.map(p => toFeedItem(p, likedIds)),
		leading: leading.map(p => toFeedItem(p, likedIds)),
		nextCursor:
			rows.length > opts.limit && last
				? encodeCursor({ at: last.publishedAt === null ? null : parseDbTimestamp(last.publishedAt), id: last.id })
				: null,
	}
}

/**
 * One maker's own published reels, newest first, for their profile.
 *
 * The same `visible` filter and the same mapper as the feed, on purpose: a reel a moderator hid, or the author deleted, is not on their profile either, and whether the viewer has liked it is answered the way the feed answers it.
 */
export async function getCreatorReels(creatorId: string, viewerId: string, limit = 24): Promise<FeedItem[]> {
	const rows = (await feedOrdered().where({ userId: creatorId }).limit(limit).all()).map(withAuthor)
	if (rows.length === 0) return []

	// One query for the viewer's likes across the whole set, exactly as the feed.
	const liked = await db.orm.public.PostLike.where(like => like.postId.in(rows.map(p => p.id)))
		.where({ userId: viewerId })
		.select("postId")
		.all()
	const likedIds = new Set(liked.map(l => l.postId))
	return rows.map(p => toFeedItem(p, likedIds))
}

export interface CreatePostInput {
	byteSize?: number | null
	/** True when the author holds MANAGE_FEED. Only they may announce. */
	canManageFeed: boolean
	caption: string
	/** The trail node this reel answers, e.g. "w3-reel-2". Null off the trail. */
	checkpointKey?: string | null
	contentType?: string | null
	durationSeconds?: number | null
	height?: number | null
	kind: PostKind
	objectKey: string
	themeProjectId?: string | null
	thumbnailKey?: string | null
	userId: string
	width?: number | null
}

/**
 * An object key must live under this user's own prefix.
 *
 * `/api/upload/presign` builds keys as `posts/<userId>/<uuid>.<ext>`, but the key travels through the browser between the upload and this call, so the server has to check it rather than trust it. Without this, a post can be created pointing at somebody else's object – or at a key outside the posts folder entirely.
 */
function assertOwnedKey(userId: string, key: string, field: string): void {
	// Ownership plus the folder: a reel's video has to be in the posts folder, so a key that is genuinely yours but was uploaded as session evidence cannot be re-filed as a reel.
	if (!isOwnedKey(userId, key) || !key.startsWith(`${POST_UPLOAD_FOLDER}/`))
		throw new HttpError("VALIDATION_FAILED", `That ${field} is not one of your uploads`)
}

/** Atomically add `delta` to a post counter, returning the new value. Prisma 8 has no `increment`, so this is one raw statement rather than read-modify-write. The column is fixed per branch because a column name cannot be interpolated. */
async function bumpPostCount(
	tx: DbOrTx,
	postId: string,
	column: "viewCount" | "likeCount" | "commentCount",
	delta: number,
): Promise<number> {
	if (column === "viewCount") {
		const plan = tx.raw
			.sql`UPDATE "post" SET "viewCount" = "viewCount" + ${delta} WHERE "id" = ${postId} RETURNING "viewCount" AS "viewCount"`
			.returnsRow({ viewCount: "pg/int4@1" })
			.build()
		const [row] = await tx.query(plan)
		if (!row) throw new HttpError("NOT_FOUND", "Post not found")
		return row.viewCount
	}
	if (column === "likeCount") {
		const plan = tx.raw
			.sql`UPDATE "post" SET "likeCount" = "likeCount" + ${delta} WHERE "id" = ${postId} RETURNING "likeCount" AS "likeCount"`
			.returnsRow({ likeCount: "pg/int4@1" })
			.build()
		const [row] = await tx.query(plan)
		if (!row) throw new HttpError("NOT_FOUND", "Post not found")
		return row.likeCount
	}
	const plan = tx.raw
		.sql`UPDATE "post" SET "commentCount" = "commentCount" + ${delta} WHERE "id" = ${postId} RETURNING "commentCount" AS "commentCount"`
		.returnsRow({ commentCount: "pg/int4@1" })
		.build()
	const [row] = await tx.query(plan)
	if (!row) throw new HttpError("NOT_FOUND", "Post not found")
	return row.commentCount
}

export async function createPost(input: CreatePostInput): Promise<FeedItem> {
	if (input.kind === PostKind.ANNOUNCEMENT && !input.canManageFeed)
		throw new HttpError("FORBIDDEN", "Only the Half Life team can post announcements")

	assertOwnedKey(input.userId, input.objectKey, "video")
	if (input.thumbnailKey) assertOwnedKey(input.userId, input.thumbnailKey, "thumbnail")

	if (input.themeProjectId) {
		// A reel can be attached to a project, but only to one of yours – otherwise a reel could be filed against someone else's submission.
		const owned = await db.orm.public.ThemeProject.where({
			deletedAt: null,
			id: input.themeProjectId,
			userId: input.userId,
		})
			.select("id")
			.first()
		if (!owned) throw new HttpError("NOT_FOUND", "Project not found")
	}

	const caption = sanitize(input.caption)
	const weekNumber = await currentWeekNumber()

	// The reel and the streak day it earns land together: a rolled-back post must not leave a day behind, exactly as a rolled-back devlog must not.
	const created = await db.transaction(async tx => {
		const now = formatDbTimestamp(new Date())
		const post = await tx.orm.public.Post.create({
			byteSize: input.byteSize ?? null,
			caption,
			checkpointKey: input.checkpointKey ?? null,
			contentType: input.contentType ?? null,
			durationSeconds: input.durationSeconds ?? null,
			height: input.height ?? null,
			kind: input.kind,
			objectKey: input.objectKey,
			publishedAt: now,
			// There is no transcoding step yet: the file is already in R2 by the time this runs, so the post is playable immediately. PROCESSING stays in the enum for when a pipeline lands and the thumbnail arrives later.
			status: PostStatus.PUBLISHED,
			themeProjectId: input.themeProjectId ?? null,
			thumbnailKey: input.thumbnailKey ?? null,
			userId: input.userId,
			weekNumber,
			width: input.width ?? null,
			...(input.kind === PostKind.ANNOUNCEMENT ? { pinnedAt: now } : {}),
		})

		// A participant's own reel, not a staff announcement.
		if (input.kind !== PostKind.ANNOUNCEMENT) await recomputeStreak(tx, input.userId)

		return post
	})

	if (input.kind !== PostKind.ANNOUNCEMENT) await markReel(input.userId, parseDbTimestamp(created.createdAt))

	const [row] = await feedOrdered().where({ id: created.id }).limit(1).all()
	if (!row) throw new HttpError("NOT_FOUND", "Post not found")
	return toFeedItem(withAuthor(row), new Set())
}

/**
 * Record that someone watched a reel.
 *
 * The unique key does the work: a repeat view is a failed insert, so the count only moves when a genuinely new viewer arrives. This matters because the program pays prizes on virality – a number anyone can inflate by refreshing is a number that decides who gets a drawing tablet.
 */
export function recordView(postId: string, userId: string): Promise<number> {
	return db.transaction(async tx => {
		// Only a live, published reel counts. Without this, views keep accruing on a hidden or deleted post, and the virality number those prizes rest on could be moved for a reel that is out of the feed.
		const post = await tx.orm.public.Post.where({ id: postId, ...visible() })
			.select("id")
			.first()
		if (!post) throw new HttpError("NOT_FOUND", "Post not found")

		const inserted = await tx.orm.public.PostView.createAll([{ postId, userId }], { onConflict: "skip" })
		if (inserted.length === 0) {
			const existing = await tx.orm.public.Post.whereUnique({ id: postId }).select("viewCount").first()
			return existing?.viewCount ?? 0
		}
		return bumpPostCount(tx, postId, "viewCount", inserted.length)
	})
}

/**
 * Like or unlike. Explicitly stated rather than toggled: a toggle sent twice by an impatient double-tap ends in whichever state the race landed on, and the client always knows which one it means.
 */
export function setLike(
	postId: string,
	userId: string,
	liked: boolean,
): Promise<{ likeCount: number; likedByMe: boolean }> {
	return db.transaction(async tx => {
		const post = await tx.orm.public.Post.where({ id: postId, ...visible() })
			.select("id")
			.first()
		if (!post) throw new HttpError("NOT_FOUND", "Post not found")

		const delta = liked
			? (await tx.orm.public.PostLike.createAll([{ postId, userId }], { onConflict: "skip" })).length
			: -(await tx.orm.public.PostLike.where({ postId, userId }).deleteAndCount())

		if (delta === 0) {
			const current = await tx.orm.public.Post.whereUnique({ id: postId }).select("likeCount").firstOrThrow()
			return { likeCount: current.likeCount, likedByMe: liked }
		}

		return { likeCount: await bumpPostCount(tx, postId, "likeCount", delta), likedByMe: liked }
	})
}

export interface CommentView {
	author: { id: string; name: string | null; image: string | null }
	body: string
	createdAt: Date
	id: string
	mine: boolean
}

export async function getComments(
	postId: string,
	viewerId: string,
	opts: { cursor?: string; limit: number },
): Promise<{ items: CommentView[]; nextCursor: string | null }> {
	// A hidden or deleted post's comments are not readable by id. The filter on the comments themselves is not enough – the parent has to be visible too.
	const post = await db.orm.public.Post.where({ id: postId, ...visible() })
		.select("id")
		.first()
	if (!post) throw new HttpError("NOT_FOUND", "Post not found")

	// Newest first, like every other conversation on the platform. The thread reads top-down from what just happened, and "show older comments" walks the cursor further back rather than forward – so the order and the affordance name the same direction.
	const position = opts.cursor === undefined ? null : decodeCursor(opts.cursor)
	// Only the API reads this list, so a cursor that is not one of ours is a bad request rather than a page to fall back to.
	const filtered = db.orm.public.PostComment.where({ deletedAt: null, postId })
		.where(comment => comment.hiddenAt.isNull())
		.orderBy([comment => comment.createdAt.desc(), comment => comment.id.desc()])
	const rows = await (position?.at
		? filtered.cursor({ createdAt: formatDbTimestamp(position.at), id: position.id })
		: filtered
	)
		.limit(opts.limit + 1)
		.select("body", "createdAt", "id")
		// No Slack id, for the same reason as the feed's author above.
		.include("user", user => user.select("displayName", "id", "image", "name"))
		.all()
	const items = rows.slice(0, opts.limit).map(c => {
		if (!c.user) throw new Error(`comment ${c.id} has no author`)
		return {
			author: { id: c.user.id, image: avatarUrl(c.user), name: displayName(c.user) },
			body: c.body,
			createdAt: parseDbTimestamp(c.createdAt),
			id: c.id,
			mine: c.user.id === viewerId,
		}
	})
	const last = items.at(-1)
	return {
		items,
		nextCursor: rows.length > opts.limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
	}
}

export function addComment(postId: string, userId: string, body: string): Promise<CommentView> {
	const clean = sanitize(body)
	if (!clean) throw new HttpError("VALIDATION_FAILED", "Say something")

	return db.transaction(async tx => {
		const post = await tx.orm.public.Post.where({ id: postId, ...visible() })
			.select("id")
			.first()
		if (!post) throw new HttpError("NOT_FOUND", "Post not found")

		const comment = await tx.orm.public.PostComment.create({ body: clean, postId, userId })
		await bumpPostCount(tx, postId, "commentCount", 1)

		const author = await tx.orm.public.User.whereUnique({ id: userId })
			.select("displayName", "id", "image", "name")
			.firstOrThrow()
		return {
			author: { id: author.id, image: avatarUrl(author), name: displayName(author) },
			body: comment.body,
			createdAt: parseDbTimestamp(comment.createdAt),
			id: comment.id,
			mine: true,
		}
	})
}

/** Delete your own comment. Moderators use `hideComment` instead. */
export async function deleteOwnComment(commentId: string, userId: string): Promise<void> {
	await db.transaction(async tx => {
		// `hiddenAt: null` too: a moderator-hidden comment already had its decrement when it was hidden, so letting the owner delete it as well would take the count down a second time and could drive it negative.
		const count = await tx.orm.public.PostComment.where({ deletedAt: null, id: commentId, userId })
			.where(comment => comment.hiddenAt.isNull())
			.updateAndCount({ deletedAt: formatDbTimestamp(new Date()) })
		if (count === 0) throw new HttpError("NOT_FOUND", "Comment not found")
		const comment = await tx.orm.public.PostComment.whereUnique({ id: commentId }).select("postId").firstOrThrow()
		await bumpPostCount(tx, comment.postId, "commentCount", -count)
	})
}

/** Soft-delete your own reel. */
export async function deleteOwnPost(postId: string, userId: string): Promise<void> {
	await db.transaction(async tx => {
		const count = await tx.orm.public.Post.where({ deletedAt: null, id: postId, userId }).updateAndCount({
			deletedAt: formatDbTimestamp(new Date()),
			status: PostStatus.REMOVED,
		})
		if (count === 0) throw new HttpError("NOT_FOUND", "Post not found")
		// Deleting the only reel on a day removes that day from the run, so the streak is recomputed with it – same rule as deleting a devlog.
		await recomputeStreak(tx, userId)
	})
}

// ─── Moderation ──────────────────────────────────────────────────────────────

export async function hidePost(postId: string, moderatorId: string, reason: string): Promise<void> {
	const count = await db.orm.public.Post.where({ deletedAt: null, id: postId }).updateAndCount({
		hiddenAt: formatDbTimestamp(new Date()),
		hiddenById: moderatorId,
		hiddenReason: sanitize(reason),
		status: PostStatus.HIDDEN,
	})
	if (count === 0) throw new HttpError("NOT_FOUND", "Post not found")
}

export async function restorePost(postId: string): Promise<void> {
	const count = await db.orm.public.Post.where({
		deletedAt: null,
		id: postId,
		status: PostStatus.HIDDEN,
	}).updateAndCount({
		hiddenAt: null,
		hiddenById: null,
		hiddenReason: null,
		status: PostStatus.PUBLISHED,
	})
	if (count === 0) throw new HttpError("NOT_FOUND", "Post not found")
}

export async function hideComment(commentId: string, moderatorId: string, reason: string): Promise<void> {
	await db.transaction(async tx => {
		const count = await tx.orm.public.PostComment.where({ deletedAt: null, id: commentId })
			.where(comment => comment.hiddenAt.isNull())
			.updateAndCount({
				hiddenAt: formatDbTimestamp(new Date()),
				hiddenById: moderatorId,
				hiddenReason: sanitize(reason),
			})
		if (count === 0) throw new HttpError("NOT_FOUND", "Comment not found")
		const comment = await tx.orm.public.PostComment.whereUnique({ id: commentId }).select("postId").firstOrThrow()
		// A hidden comment is out of the feed, so it is out of the count too.
		await bumpPostCount(tx, comment.postId, "commentCount", -count)
	})
}

export { PostKind, PostStatus } from "@/lib/enums"
