import { describe, expect, test } from "bun:test"
import { PostKind } from "@/lib/enums"
import {
	commentSchema,
	createPostSchema,
	likeSchema,
	moderatePostSchema,
	publicReelLinksSchema,
} from "@/lib/schemas/feed"

const validPost = {
	caption: "Look at this",
	objectKey: "sessions/abc/def.png",
}

describe("createPostSchema", () => {
	test("accepts a minimal post with freeform defaults", () => {
		const parsed = createPostSchema.safeParse(validPost)
		expect(parsed.success).toBe(true)
		if (parsed.success) expect(parsed.data.kind).toBe(PostKind.FREEFORM)
	})

	test("checkpoint keys are reel nodes, not anything else", () => {
		expect(createPostSchema.safeParse({ ...validPost, checkpointKey: "w3-reel-2" }).success).toBe(true)
		expect(createPostSchema.safeParse({ ...validPost, checkpointKey: "wu-abc_1-reel-submission" }).success).toBe(true)
		expect(createPostSchema.safeParse({ ...validPost, checkpointKey: "w3-entry-1" }).success).toBe(false)
	})

	test("object keys stay path-shaped", () => {
		expect(createPostSchema.safeParse({ ...validPost, objectKey: "a b.png" }).success).toBe(false)
		expect(createPostSchema.safeParse({ ...validPost, durationSeconds: 24 * 3600 + 1 }).success).toBe(false)
		expect(createPostSchema.safeParse({ ...validPost, kind: "nope" }).success).toBe(false)
		expect(createPostSchema.safeParse({ ...validPost, extra: 1 }).success).toBe(false)
	})
})

describe("likeSchema / commentSchema / moderatePostSchema", () => {
	test("likes are boolean and bodies are required", () => {
		expect(likeSchema.safeParse({ liked: true }).success).toBe(true)
		expect(likeSchema.safeParse({ liked: "yes" }).success).toBe(false)
		expect(commentSchema.safeParse({ body: "Nice!" }).success).toBe(true)
		expect(commentSchema.safeParse({ body: "" }).success).toBe(false)
		expect(moderatePostSchema.safeParse({ reason: "spam" }).success).toBe(true)
		expect(moderatePostSchema.safeParse({}).success).toBe(false)
	})
})

describe("publicReelLinksSchema", () => {
	test("takes one link per platform, at most four", () => {
		const one = { links: [{ platform: "TIKTOK", url: "https://tiktok.com/@you/video/1" }] } as const
		expect(publicReelLinksSchema.safeParse(one).success).toBe(true)
		const dup = {
			links: [
				{ platform: "TIKTOK", url: "https://tiktok.com/@you/video/1" },
				{ platform: "TIKTOK", url: "https://tiktok.com/@you/video/2" },
			],
		}
		expect(publicReelLinksSchema.safeParse(dup).success).toBe(false)
		expect(publicReelLinksSchema.safeParse({ links: [] }).success).toBe(false)
		const five = {
			links: Array.from({ length: 5 }, (_, i) => ({ platform: "X", url: `https://x.com/u/status/${i}` })),
		}
		expect(publicReelLinksSchema.safeParse({ links: five.links.slice(0, 4) }).success).toBe(false)
		expect(publicReelLinksSchema.safeParse({ links: five.links.slice(0, 1) }).success).toBe(true)
	})
})
