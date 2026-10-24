import { describe, expect, test } from "bun:test"
import { readPublicReelLink } from "@/lib/public-reels"

describe("readPublicReelLink", () => {
	test("tidies a post link into canonical form", () => {
		expect(readPublicReelLink("TIKTOK", "https://www.tiktok.com/@you/video/123?igsh=abc")).toEqual({
			url: "https://tiktok.com/@you/video/123",
		})
	})

	test("unifies X's old hostname", () => {
		expect(readPublicReelLink("X", "twitter.com/you/status/1")).toEqual({ url: "https://x.com/you/status/1" })
	})

	test("keeps YouTube's video id and drops the rest", () => {
		expect(readPublicReelLink("YOUTUBE", "https://youtu.be/abc?v=abc&t=30")).toEqual({
			url: "https://youtu.be/abc?v=abc",
		})
	})

	test("refuses the wrong platform and bare homepages", () => {
		expect(readPublicReelLink("TIKTOK", "https://youtube.com/shorts/abc")).toEqual({
			error: "That isn't a TikTok link – it should look like tiktok.com/@you/video/…",
		})
		expect(readPublicReelLink("X", "https://x.com")).toEqual({
			error: "That's X (Twitter) itself, not a post. Open your post and copy its link.",
		})
		expect(readPublicReelLink("X", "   ")).toEqual({ error: "Paste the link to your X (Twitter) post." })
		expect(readPublicReelLink("X", "https://exa mple.com/x")).toEqual({
			error: "That isn't a link. Copy it from the post's Share button on X (Twitter).",
		})
	})
})
