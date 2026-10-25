import { describe, expect, test } from "bun:test"
import { displayName } from "@/lib/display-name"

describe("displayName", () => {
	test("prefers the nickname, then the full name, then the fallback", () => {
		expect(displayName({ displayName: "Ada", name: "Ada Lovelace" }, "A maker")).toBe("Ada")
		expect(displayName({ displayName: null, name: "Ada Lovelace" }, "A maker")).toBe("Ada Lovelace")
		expect(displayName({ displayName: null, name: null }, "A maker")).toBe("A maker")
		expect(displayName(null, null)).toBeNull()
	})

	test("never returns a stored email address", () => {
		// Sign-up stores the email as `name` when HCA sends none (better-auth requires the field); it must not render as the public name.
		expect(displayName({ displayName: null, name: "ada@example.com" }, "A maker")).toBe("A maker")
		expect(displayName({ displayName: "ada@example.com", name: "Ada Lovelace" }, "A maker")).toBe(
			"Ada Lovelace",
		)
		// An explicitly passed fallback is the caller's choice and is returned untouched.
		expect(displayName({ displayName: null, name: null }, "ada@example.com")).toBe("ada@example.com")
	})

	test("leaves non-address handles alone", () => {
		expect(displayName({ displayName: "@octocat", name: null }, "A maker")).toBe("@octocat")
	})
})
