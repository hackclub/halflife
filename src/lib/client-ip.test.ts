import { describe, expect, test } from "bun:test"
import { clientIp } from "@/lib/client-ip"

function headers(values: { [_: string]: string | null }): { get(name: string): string | null } {
	const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
	return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

describe("clientIp", () => {
	test("prefers the Cloudflare header", () => {
		const h = headers({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" })
		expect(clientIp(h)).toBe("1.2.3.4")
	})

	test("takes the last forwarded entry, the one the edge saw", () => {
		const h = headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })
		expect(clientIp(h)).toBe("2.2.2.2")
	})

	test("falls back to x-real-ip, then unknown", () => {
		expect(clientIp(headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8")
		expect(clientIp(headers({}))).toBe("unknown")
		expect(clientIp(headers({ "x-forwarded-for": "   " }))).toBe("unknown")
	})

	test("trims whitespace", () => {
		expect(clientIp(headers({ "cf-connecting-ip": "  1.2.3.4  " }))).toBe("1.2.3.4")
	})
})
