import "server-only"
import { lookup as dnsLookup, type LookupAddress, type LookupAllOptions, type LookupOneOptions } from "node:dns"
import http, { type IncomingMessage } from "node:http"
import https from "node:https"
import { BlockList, isIP } from "node:net"
import { HttpError } from "@/lib/errors"

/**
 * Fetch an image from somewhere else on the web, so it can be re-hosted in the bucket. This is what an image dragged in from another page arrives as: its address, not its bytes, and the browser cannot read another site's image
 * for us.
 *
 * The server fetching a URL a user chose is the textbook way in to its private network, so everything here is about refusing that:
 *
 * - http and https on their standard ports only;
 * - no private, loopback, link-local or otherwise reserved address, checked in the DNS lookup the connection itself uses – so a name that resolves to a public address when asked and a private one when connected ("DNS rebinding") still cannot get through – and for IP literals, which skip the lookup entirely;
 * - every redirect is checked the same way, and there are at most three;
 * - a time limit on the whole thing, and a byte cap that stops reading;
 * - and the bytes must actually be a PNG, JPEG, GIF or WebP, whatever the Content-Type says. SVG is refused: it can carry script.
 */

const MAX_REDIRECTS = 3
const TIMEOUT_MS = 10_000

const blocked = new BlockList()
for (const [net, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const) {
	blocked.addSubnet(net, prefix, "ipv4")
}
for (const [net, prefix] of [
	["::", 128],
	["::1", 128],
	// No rule for IPv4-mapped addresses (::ffff:0:0/96): BlockList already checks `::ffff:10.0.0.1` against the IPv4 rules above, and it also checks every plain IPv4 address against a mapped rule – so one here would refuse the whole IPv4 internet. NAT64 is not unwrapped, so it is refused outright.
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	blocked.addSubnet(net, prefix, "ipv6")
}

function isBlocked(address: string, family: number): boolean {
	return blocked.check(address, family === 6 ? "ipv6" : "ipv4")
}

const refused = () => new HttpError("VALIDATION_FAILED", "That image's address can't be fetched")

/**
 * `lookup` for the request: resolves as usual, then refuses if any address is one we will not connect to. Answers in whichever shape Node asked for – newer versions ask for every address, to race IPv4 against IPv6.
 */
function safeLookup(
	hostname: string,
	options: LookupOneOptions | LookupAllOptions,
	callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
): void {
	dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
		if (err) return callback(err, "")
		const list = addresses as LookupAddress[]
		const first = list[0]
		if (!first || list.some(a => isBlocked(a.address, a.family))) {
			return callback(Object.assign(new Error(`Refused to connect to ${hostname}`), { code: "EBLOCKED" }), "")
		}
		if (options.all) callback(null, list)
		else callback(null, first.address, first.family)
	})
}

function assertFetchable(url: URL): void {
	if (url.protocol !== "https:" && url.protocol !== "http:") throw refused()
	if (url.port && url.port !== "443" && url.port !== "80") throw refused()
	if (url.username || url.password) throw refused()
	// An IP literal never reaches the lookup, so it is checked here.
	const host = url.hostname.replace(/^\[|\]$/g, "")
	const family = isIP(host)
	if (family !== 0 && isBlocked(host, family)) throw refused()
}

function get(url: URL, signal: AbortSignal): Promise<IncomingMessage> {
	return new Promise((resolve, reject) => {
		const client = url.protocol === "https:" ? https : http
		const req = client.get(
			url,
			{
				headers: { accept: "image/png,image/jpeg,image/gif,image/webp", "user-agent": "HalfLife-ImageImport/1.0" },
				lookup: safeLookup,
				signal,
			},
			resolve,
		)
		req.on("error", reject)
	})
}

async function readCapped(res: IncomingMessage, maxBytes: number): Promise<Buffer> {
	const chunks: Buffer[] = []
	let size = 0
	for await (const chunk of res) {
		size += (chunk as Buffer).length
		if (size > maxBytes) {
			res.destroy()
			throw new HttpError("VALIDATION_FAILED", "That image is too large")
		}
		chunks.push(chunk as Buffer)
	}
	return Buffer.concat(chunks)
}

/** What the bytes are, from their first few, or null if not an image we take. */
export function sniffImage(bytes: Buffer): { ext: string; contentType: string } | null {
	if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
		return { contentType: "image/png", ext: "png" }
	}
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return { contentType: "image/jpeg", ext: "jpg" }
	}
	if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString("latin1"))) {
		return { contentType: "image/gif", ext: "gif" }
	}
	if (
		bytes.length >= 12
		&& bytes.subarray(0, 4).toString("latin1") === "RIFF"
		&& bytes.subarray(8, 12).toString("latin1") === "WEBP"
	) {
		return { contentType: "image/webp", ext: "webp" }
	}
	return null
}

export async function fetchRemoteImage(
	raw: string,
	maxBytes: number,
): Promise<{ bytes: Buffer; ext: string; contentType: string }> {
	let url: URL
	try {
		url = new URL(raw)
	} catch {
		throw refused()
	}

	const signal = AbortSignal.timeout(TIMEOUT_MS)
	try {
		for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
			assertFetchable(url)
			const res = await get(url, signal)
			const status = res.statusCode ?? 0

			if ([301, 302, 303, 307, 308].includes(status)) {
				const location = res.headers.location
				res.resume()
				if (!location) throw refused()
				url = new URL(location, url)
				continue
			}
			if (status !== 200) {
				res.resume()
				throw new HttpError("VALIDATION_FAILED", `That image could not be fetched (${status})`)
			}
			const declared = Number(res.headers["content-length"])
			if (Number.isFinite(declared) && declared > maxBytes) {
				res.destroy()
				throw new HttpError("VALIDATION_FAILED", "That image is too large")
			}

			const bytes = await readCapped(res, maxBytes)
			const kind = sniffImage(bytes)
			if (!kind) throw new HttpError("VALIDATION_FAILED", "That isn't a PNG, JPEG, GIF or WebP image")
			return { bytes, ...kind }
		}
		throw new HttpError("VALIDATION_FAILED", "That image's address redirects too many times")
	} catch (err) {
		if (err instanceof HttpError) throw err
		// Timeouts, refused lookups, resets: the detail is for the log, not the maker.
		console.warn("[uploads] remote image fetch failed:", err)
		throw new HttpError("VALIDATION_FAILED", "That image could not be fetched. Save it and drop the file in instead.")
	}
}
