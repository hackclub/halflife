import { z } from "zod"

/**
 * A feed row as the API sends it.
 *
 * Kept out of `lib/feed.ts`, which is server-only: the Doomscroller reads the same shape in the browser. `publishedAt` arrives as an ISO string and is coerced back to a `Date`.
 */
export const FeedAuthorSchema = z.object({
	id: z.string(),
	image: z.string().nullable(),
	name: z.string().nullable(),
	streak: z.number(),
})
export type FeedAuthor = z.infer<typeof FeedAuthorSchema>

export const FeedItemSchema = z.object({
	author: FeedAuthorSchema,
	caption: z.string(),
	commentCount: z.number(),
	durationSeconds: z.number().nullable(),
	height: z.number().nullable(),
	id: z.string(),
	kind: z.enum(["ANNOUNCEMENT", "FREEFORM", "IDEA", "PROGRESS", "SUBMISSION"]),
	likeCount: z.number(),
	likedByMe: z.boolean(),
	pinned: z.boolean(),
	project: z.object({ id: z.string(), theme: z.string(), title: z.string() }).nullable(),
	publishedAt: z.coerce.date().nullable(),
	thumbnailUrl: z.string().nullable(),
	videoUrl: z.string().nullable(),
	viewCount: z.number(),
	width: z.number().nullable(),
})
export type FeedItem = z.infer<typeof FeedItemSchema>

export const FeedPageSchema = z.object({
	items: z.array(FeedItemSchema),
	leading: z.array(FeedItemSchema),
	nextCursor: z.string().nullable(),
})
export type FeedPage = z.infer<typeof FeedPageSchema>
