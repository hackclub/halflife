import { describe, expect, test } from "bun:test"
import { renderReviewMarkdown } from "@/lib/review-platform/markdown"

describe("renderReviewMarkdown", () => {
	test("drops every URL attribute that points at our own hosts", () => {
		const html = renderReviewMarkdown(
			[
				'<video src="https://halflife.hackclub.com/api/integrations/hcb/callback?code=x"></video>',
				'<video poster="https://halflife.hackclub.com/signed-out"></video>',
				'<audio src="https://half-life.k.hackclub.dev/signed-out"></audio>',
				'<img src="https://halflife.hackclub.com/signed-out">',
				'<source src="https://halflife.hackclub.com/signed-out">',
				'<img src="https://example.com/ok.png" srcset="https://halflife.hackclub.com/x.png 1x, https://example.com/y.png 2x">',
			].join("\n"),
		)
		expect(html).not.toContain("halflife.hackclub.com")
		expect(html).not.toContain("half-life.k.hackclub.dev")
		expect(html).toContain("https://example.com/ok.png")
		expect(html).toContain("https://example.com/y.png 2x")
		expect(html).not.toContain("x.png 1x")
	})
})
