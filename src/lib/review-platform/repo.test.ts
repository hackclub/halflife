import { describe, expect, test } from "bun:test"
import { githubRepoFrom, isGithubRepo } from "@/lib/review-platform/repo"

describe("githubRepoFrom", () => {
	test("reads owner/name out of the links makers actually paste", () => {
		expect(githubRepoFrom("https://github.com/JH-2108/Robotic-Arm")).toBe("JH-2108/Robotic-Arm")
		expect(githubRepoFrom("https://github.com/Sujay-Patel-GitHub/desai-mocha.git")).toBe(
			"Sujay-Patel-GitHub/desai-mocha",
		)
		expect(githubRepoFrom("github.com/a/b")).toBe("a/b")
		expect(githubRepoFrom("https://www.github.com/a/b/tree/main/hardware")).toBe("a/b")
		expect(githubRepoFrom("  https://github.com/a/b.c_d-e  ")).toBe("a/b.c_d-e")
	})

	test("is null for anything the file viewer cannot open", () => {
		expect(githubRepoFrom(null)).toBeNull()
		expect(githubRepoFrom("")).toBeNull()
		expect(githubRepoFrom("https://google.com")).toBeNull()
		expect(githubRepoFrom("https://gitlab.com/a/b")).toBeNull()
		expect(githubRepoFrom("https://github.com/a")).toBeNull()
		expect(githubRepoFrom("https://github.com.evil.example/a/b")).toBeNull()
		expect(githubRepoFrom("https://github.com/a/..")).toBeNull()
		expect(githubRepoFrom("not a url at all")).toBeNull()
	})
})

describe("isGithubRepo", () => {
	test("accepts owner/name and refuses path tricks", () => {
		expect(isGithubRepo("hackclub/halflife")).toBe(true)
		expect(isGithubRepo("hackclub/halflife/extra")).toBe(false)
		expect(isGithubRepo("../etc")).toBe(false)
		expect(isGithubRepo("hackclub/.")).toBe(false)
	})
})
