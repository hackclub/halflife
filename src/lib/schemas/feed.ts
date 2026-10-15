import { z } from "zod"
import { PostKind } from "@/app/generated/prisma/enums"
import { boundedText, cuid } from "@/lib/schemas/common"

/**
 * Object keys are shape-checked here and OWNERSHIP-checked in lib/feed.ts. This only rejects the obviously malformed; whether the key belongs to the person posting is a question the database has to answer, not a regex.
 */
const objectKey = z
	.string()
	.trim()
	.min(1)
	.max(500)
	.regex(/^[A-Za-z0-9/_.-]+$/, "Not a valid object key")

export const createPostSchema = z
	.object({
		kind: z.enum(PostKind).default(PostKind.FREEFORM),
		caption: boundedText(2000),
		objectKey,
		thumbnailKey: objectKey.nullish(),
		themeProjectId: cuid.nullish(),
		/**
		 * The trail node this reel answers, e.g. "w3-reel-2". Bounded and pattern- matched rather than free text: it is written straight into a column the trail reads back by key, so anything that is not a checkpoint id is a row nothing will ever find again.
		 */
		checkpointKey: z
			.string()
			.regex(
				/^(w([1-9]|10)-reel-(idea|submission|\d{1,2})|wu-[A-Za-z0-9_]{1,64}-reel-submission)$/,
				"Not a reel checkpoint",
			)
			.nullish(),
		contentType: boundedText(100).nullish(),
		byteSize: z.number().int().min(0).nullish(),
		durationSeconds: z
			.number()
			.int()
			.min(0)
			.max(24 * 3600)
			.nullish(),
		width: z.number().int().min(0).max(20000).nullish(),
		height: z.number().int().min(0).max(20000).nullish(),
	})
	.strict()

export const likeSchema = z.object({ liked: z.boolean() }).strict()

/**
 * The public links for one reel, one per platform at most. The URL is only length-checked here; whether it is really a link to that platform, and its tidy stored form, is lib/public-reels.ts's call, shared with the dialog.
 */
export const publicReelLinksSchema = z
	.object({
		links: z
			.array(
				z
					.object({
						platform: z.enum(["INSTAGRAM", "TIKTOK", "X", "YOUTUBE"]),
						url: z.string().trim().min(1).max(500),
					})
					.strict(),
			)
			.min(1, "Add at least one link")
			.max(4)
			.refine(links => new Set(links.map(l => l.platform)).size === links.length, {
				message: "One link per platform",
			}),
	})
	.strict()

export const commentSchema = z.object({ body: boundedText(1000, 1) }).strict()

export const moderatePostSchema = z.object({ reason: boundedText(1000, 1) }).strict()
