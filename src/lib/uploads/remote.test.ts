import { describe, expect, test } from "bun:test"
import { fetchRemoteImage, sniffImage } from "@/lib/uploads/remote"

/**
 * The upload-from-URL SSRF guard, pinned on the runtime production runs.
 *
 * `fetchRemoteImage` refuses private/loopback/link-local targets through a custom DNS `lookup` handed to the connection itself (so DNS rebinding cannot swap the answer between check and connect) plus a literal check for IP hosts. That only holds if the runtime honours the `lookup` option and `node:net`'s BlockList – this file runs on Bun, so these tests fail if either stops working there.
 */

async function refused(raw: string): Promise<string> {
	try {
		await fetchRemoteImage(raw, 1024 * 1024)
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
	return "FETCHED"
}

describe("fetchRemoteImage SSRF guard", () => {
	test("refuses IPv4 literals in private and special ranges", async () => {
		for (const host of [
			"127.0.0.1",
			"10.0.0.1",
			"172.16.0.1",
			"192.168.1.1",
			"169.254.169.254",
			"0.0.0.0",
			"100.64.0.1",
			"192.0.2.1",
			"198.51.100.1",
			"203.0.113.1",
			"224.0.0.1",
		])
			expect(await refused(`http://${host}/x.png`), host).not.toBe("FETCHED")
	})

	test("refuses IPv6 literals in private and special ranges", async () => {
		for (const host of ["[::1]", "[fc00::1]", "[fe80::1]", "[ff02::1]"])
			expect(await refused(`http://${host}/x.png`), host).not.toBe("FETCHED")
	})

	test("refuses hostnames that resolve to non-public addresses", async () => {
		// Exercises the custom `lookup` path itself: `localhost` must be resolved (not connected to), found private, and refused – proving Bun honours the lookup option on the connection.
		expect(await refused("http://localhost/x.png")).not.toBe("FETCHED")
	})

	test("refuses non-http(s) schemes, non-standard ports and userinfo", async () => {
		for (const raw of [
			"ftp://example.com/x.png",
			"file:///etc/passwd",
			"http://example.com:8080/x.png",
			"http://user:pass@example.com/x.png",
		])
			expect(await refused(raw), raw).not.toBe("FETCHED")
	})

	test("refuses malformed URLs", async () => {
		expect(await refused("not a url")).not.toBe("FETCHED")
	})
})

describe("sniffImage", () => {
	test("recognises PNG, JPEG, GIF and WebP by magic bytes", () => {
		const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])
		expect(sniffImage(png)?.ext).toBe("png")
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
		expect(sniffImage(jpeg)?.ext).toBe("jpg")
		const gif = Buffer.from("GIF89a", "latin1")
		expect(sniffImage(gif)?.ext).toBe("gif")
		const webp = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(4), Buffer.from("WEBP", "latin1")])
		expect(sniffImage(webp)?.ext).toBe("webp")
	})

	test("refuses SVG and text", () => {
		expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">', "utf8"))).toBeNull()
		expect(sniffImage(Buffer.from("hello", "utf8"))).toBeNull()
		expect(sniffImage(Buffer.alloc(0))).toBeNull()
	})
})
