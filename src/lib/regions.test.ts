import { describe, expect, test } from "bun:test"
import { countryOfTimezone, REGIONS, regionOfTimezone } from "@/lib/regions"

describe("regionOfTimezone", () => {
	test("buckets IANA areas", () => {
		expect(regionOfTimezone("America/New_York")).toBe("americas")
		expect(regionOfTimezone("Europe/London")).toBe("europe")
		expect(regionOfTimezone("Asia/Tokyo")).toBe("asia")
		expect(regionOfTimezone("Africa/Cairo")).toBe("africa")
		expect(regionOfTimezone("Australia/Sydney")).toBe("oceania")
		expect(regionOfTimezone("Pacific/Auckland")).toBe("oceania")
	})

	test("handles the placeless and the missing", () => {
		expect(regionOfTimezone("UTC")).toBe("other")
		expect(regionOfTimezone(null)).toBe("unknown")
		expect(regionOfTimezone(undefined)).toBe("unknown")
		expect(regionOfTimezone("")).toBe("unknown")
	})
})

describe("countryOfTimezone / REGIONS", () => {
	test("names known zones and admits the rest", () => {
		expect(countryOfTimezone("America/New_York")).toBe("United States")
		expect(countryOfTimezone(null)).toBe("Unknown")
		expect(countryOfTimezone("Mars/Olympus")).toBe("Unknown")
	})

	test("every region has a label", () => {
		expect(REGIONS.map(r => r.id)).toEqual(["americas", "europe", "asia", "africa", "oceania", "other", "unknown"])
		for (const region of REGIONS) expect(region.label.length).toBeGreaterThan(0)
	})
})
