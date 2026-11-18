import { describe, expect, test } from "bun:test"
import { countImages, safeSrc } from "@/lib/markdown"

describe("safeSrc", () => {
	test("keeps an outside picture", () => {
		expect(safeSrc("https://i.imgur.com/a.png")).toBe("https://i.imgur.com/a.png")
		expect(safeSrc("https://example.com/a.png")).toBe("https://example.com/a.png")
		expect(safeSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA")
	})

	test("refuses a relative path", () => {
		expect(safeSrc("/signed-out")).toBeUndefined()
		expect(safeSrc("api/integrations/hcb/callback?code=x")).toBeUndefined()
	})

	test("refuses our own hosts, whatever the path", () => {
		// The callback writes the deployment's HCB credential, so a journal image must never be able to aim at it.
		expect(safeSrc("https://halflife.hackclub.com/api/integrations/hcb/callback?code=x")).toBeUndefined()
		expect(safeSrc("https://half-life.k.hackclub.dev/signed-out")).toBeUndefined()
		expect(safeSrc("http://halflife.hackclub.com/signed-out")).toBeUndefined()
	})

	test("does not count a designed-for image that safeSrc drops", () => {
		expect(countImages("![x](https://halflife.hackclub.com/signed-out)")).toBe(0)
	})
})
