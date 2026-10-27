import { describe, expect, spyOn, test } from "bun:test"
import { readLapsePage } from "@/lib/lapse-timelapses"

const timelapse = {
	attached: false,
	createdAt: 1_700_000_000_000,
	durationSeconds: 3_600,
	hackatimeProject: null,
	id: "cm1lapse",
	processing: false,
	thumbnailUrl: null,
	title: "Soldering",
	visibility: "PUBLIC" as const,
}

describe("readLapsePage", () => {
	test("a Lapse link that needs renewing asks for sign-in rather than showing an error", () => {
		const read = readLapsePage(422, {
			error: { code: "LAPSE_NOT_LINKED", message: "Sign in with Lapse to pick your timelapses" },
		})
		expect(read).toEqual({ unlinked: true })
	})

	test("a refusal keeps the route's own message", () => {
		const read = readLapsePage(503, {
			error: { code: "LAPSE_UNAVAILABLE", message: "Lapse is not answering right now. Try again in a minute" },
		})
		expect(read).toEqual({ error: "Lapse is not answering right now. Try again in a minute" })
	})

	test("a refusal without our envelope names the status instead of saying nothing useful", () => {
		expect(readLapsePage(504, null)).toEqual({
			error: "The timelapse list could not be loaded (HTTP 504). This is usually temporary – try again in a minute.",
		})
	})

	test("a signed-out response says so", () => {
		expect(readLapsePage(401, null)).toEqual({
			error: "You are signed out. Refresh the page and sign in again.",
		})
	})

	test("a page of timelapses is read as one", () => {
		expect(readLapsePage(200, { nextCursor: "abc", timelapses: [timelapse] })).toEqual({
			page: { nextCursor: "abc", timelapses: [timelapse] },
		})
	})

	test("a success body this shape cannot read is named as such, not as a generic failure", () => {
		const quiet = spyOn(console, "error").mockImplementation(() => undefined)
		try {
			expect(readLapsePage(200, { timelapses: [{ id: "only-an-id" }] })).toEqual({
				error: "The timelapse list came back unreadable. Try again, and let us know if it keeps happening.",
			})
		} finally {
			quiet.mockRestore()
		}
	})
})
