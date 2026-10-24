import { describe, expect, test } from "bun:test"
import {
	ONSHAPE_REPO_ERROR,
	containsOnshapeLink,
	displayRepo,
	isOnshapeHost,
	isOnshapeLink,
	normalizeRepo,
	validateRepoField,
} from "@/lib/repo"

describe("isOnshapeHost", () => {
	test("matches Onshape and its subdomains", () => {
		expect(isOnshapeHost("onshape.com")).toBe(true)
		expect(isOnshapeHost("cad.onshape.com")).toBe(true)
		expect(isOnshapeHost("CAD.ONSHAPE.COM.")).toBe(true)
	})

	test("rejects lookalikes", () => {
		expect(isOnshapeHost("notonshape.com")).toBe(false)
		expect(isOnshapeHost("onshape.com.evil.com")).toBe(false)
		expect(isOnshapeHost("github.com")).toBe(false)
	})
})

describe("isOnshapeLink / containsOnshapeLink", () => {
	test("reads links with or without a scheme", () => {
		expect(isOnshapeLink("https://cad.onshape.com/documents/abc")).toBe(true)
		expect(isOnshapeLink("cad.onshape.com/documents/abc")).toBe(true)
		expect(isOnshapeLink("https://github.com/me/repo")).toBe(false)
		expect(isOnshapeLink("")).toBe(false)
		expect(isOnshapeLink("not a url at all")).toBe(false)
	})

	test("finds links inside prose", () => {
		expect(containsOnshapeLink("see https://cad.onshape.com/documents/abc for the model")).toBe(true)
		expect(containsOnshapeLink("see https://github.com/me/repo for the code")).toBe(false)
	})
})

describe("normalizeRepo", () => {
	test("adds a missing scheme and trims slashes", () => {
		expect(normalizeRepo("github.com/me/hackpad")).toEqual({ error: null, url: "https://github.com/me/hackpad" })
		expect(normalizeRepo("https://github.com/me/hackpad.git")).toEqual({
			error: null,
			url: "https://github.com/me/hackpad.git",
		})
	})

	test("accepts any http(s) host but refuses the rest", () => {
		expect(normalizeRepo("https://gitlab.com/me/repo").error).toBeNull()
		expect(normalizeRepo("ftp://example.com/repo").error).toBe("That needs to be a web link.")
		expect(normalizeRepo("notaurl").error).toBe("That does not look like a repo link.")
		expect(normalizeRepo("https://exa mple.com").error).toBe("That does not look like a repo link.")
		expect(normalizeRepo("").url).toBeNull()
	})
})

describe("validateRepoField", () => {
	test("refuses Onshape documents with their own message", () => {
		expect(validateRepoField("https://cad.onshape.com/documents/abc")).toEqual({ error: ONSHAPE_REPO_ERROR, url: null })
	})

	test("passes normal repos through", () => {
		expect(validateRepoField("github.com/me/hackpad")).toEqual({
			error: null,
			url: "https://github.com/me/hackpad",
		})
	})
})

describe("displayRepo", () => {
	test("drops scheme, www, .git and trailing slash", () => {
		expect(displayRepo("https://www.github.com/me/hackpad.git")).toBe("github.com/me/hackpad")
		expect(displayRepo("http://github.com/me/hackpad/")).toBe("github.com/me/hackpad")
	})
})
