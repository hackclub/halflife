import { NextResponse } from "next/server"
import { fail } from "@/lib/api"
import { type AuthedContext, withPermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import { rateLimited } from "@/lib/rate-limit"
import { isProxiedMediaUrl } from "@/lib/review-platform/offline"

export const dynamic = "force-dynamic"

const MAX_REDIRECTS = 3
const PASSED_HEADERS = Object.freeze([
	"content-type",
	"content-length",
	"content-range",
	"accept-ranges",
	"last-modified",
	"etag",
])

/**
 * A picture or video from Hack Club's own asset hosts, read through this server so a reviewer's browser can keep a copy for offline review (`/reviews/offline`).
 *
 * Half Life's bucket serves its objects without CORS headers, and Lapse's delivery host only names the production origin, so the browser can show them but not store them. Only the hosts in `isProxiedMediaUrl` are read, every redirect included, so this can never be turned on an internal address. Ranges pass through, so videos can be fetched in pieces.
 */
export const GET = withPermission(Permission.REVIEW_SUBMISSIONS, async (req: Request, { gate }: AuthedContext) => {
	if (rateLimited(`review-media:${gate.user.id}`, { max: 600, windowMs: 60_000 }))
		return fail("RATE_LIMITED", "Too many requests, slow down.")
	let target = new URL(req.url).searchParams.get("url") ?? ""
	if (!isProxiedMediaUrl(target)) return fail("VALIDATION_FAILED", "That address isn't one of Hack Club's asset hosts")

	const range = req.headers.get("range")
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		let upstream: Response
		try {
			upstream = await fetch(target, {
				cache: "no-store",
				headers: range ? { range } : {},
				redirect: "manual",
				signal: req.signal,
			})
		} catch {
			return fail("UNAVAILABLE", "Couldn't reach the asset host")
		}
		const location = upstream.headers.get("location")
		if (upstream.status >= 300 && upstream.status < 400 && location) {
			await upstream.body?.cancel()
			const next = new URL(location, target).toString()
			if (!isProxiedMediaUrl(next)) return fail("VALIDATION_FAILED", "The asset host redirected somewhere else")
			target = next
			continue
		}
		const headers = new Headers({ "cache-control": "private, no-store" })
		for (const name of PASSED_HEADERS) {
			const value = upstream.headers.get(name)
			if (value) headers.set(name, value)
		}
		return new NextResponse(upstream.body, { headers, status: upstream.status })
	}
	return fail("UNAVAILABLE", "Too many redirects")
})
