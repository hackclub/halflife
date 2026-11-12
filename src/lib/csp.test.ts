import { describe, expect, test } from "bun:test"
import { contentSecurityPolicy, isReviewPlatformPath } from "@/lib/csp"

const directive = (policy: string, name: string): string[] =>
	policy
		.split("; ")
		.find(part => part.startsWith(`${name} `))
		?.split(" ")
		.slice(1) ?? []

describe("isReviewPlatformPath", () => {
	test("is the review platform and nothing that merely starts like it", () => {
		expect(isReviewPlatformPath("/reviews")).toBe(true)
		expect(isReviewPlatformPath("/reviews/cmv9616u5019701r950n0mdqg")).toBe(true)
		expect(isReviewPlatformPath("/review")).toBe(false)
		expect(isReviewPlatformPath("/review/abc")).toBe(false)
		expect(isReviewPlatformPath("/reviewsx")).toBe(false)
		expect(isReviewPlatformPath("/dashboard")).toBe(false)
		expect(isReviewPlatformPath("")).toBe(false)
	})
})

describe("contentSecurityPolicy", () => {
	test("keeps GitHub's image hosts out of the participant-facing policy", () => {
		const img = directive(contentSecurityPolicy(), "img-src")
		expect(img).toContain("'self'")
		expect(img).not.toContain("https://raw.githubusercontent.com")
		expect(img).not.toContain("https://private-user-images.githubusercontent.com")
		expect(img).not.toContain("https://github.com")
	})

	test("lets the review platform draw a README's GitHub images and videos", () => {
		const policy = contentSecurityPolicy({ reviewPlatform: true })
		for (const name of ["img-src", "media-src"]) {
			const hosts = directive(policy, name)
			expect(hosts).toContain("https://raw.githubusercontent.com")
			expect(hosts).toContain("https://private-user-images.githubusercontent.com")
			expect(hosts).toContain("https://github.com")
		}
	})

	test("widens only images and media, not framing or form targets", () => {
		const base = contentSecurityPolicy().split("; ")
		const review = contentSecurityPolicy({ reviewPlatform: true }).split("; ")
		const others = (parts: string[]) => parts.filter(part => !/^(img|media)-src /.test(part))
		expect(others(review)).toEqual(others(base))
	})
})
