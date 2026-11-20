import { describe, expect, test } from "bun:test"
import { hcbGrantUrl } from "@/lib/hcb-grant-url"

describe("hcbGrantUrl", () => {
	test("drops the cdg_ prefix HCB stores on a card grant", () => {
		expect(hcbGrantUrl("cdg_gkI8DM")).toBe("https://hcb.hackclub.com/grants/gkI8DM")
	})

	test("leaves an id without the prefix as it is", () => {
		expect(hcbGrantUrl("gkI8DM")).toBe("https://hcb.hackclub.com/grants/gkI8DM")
	})
})
