import type { NextRequest } from "next/server"
import { getAnalyticsSummary, getUserAnalytics } from "@/lib/analytics"
import { ok, withRoute } from "@/lib/api"
import { requireIntegrationAuth } from "@/lib/integration-auth"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * The analytics time markers, for whatever pushes them onward (the Loops
 * properties in Airtable) and for anyone checking the numbers.
 *
 * `summary` is program-wide: DAU per day, the funnel with drop-off at each
 * step, and how many people crossed 1h / 5h / 10h / 20h in each week. Add
 * `?users=true` for one row per person with every timestamp, hours, coins and
 * streaks – that includes emails, so it sits behind the integration key.
 */
export const GET = withRoute(async (req: NextRequest) => {
	const denied = requireIntegrationAuth(req)
	if (denied) return denied

	const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30))
	const withUsers = req.nextUrl.searchParams.get("users") === "true"

	const [summary, users] = await Promise.all([
		getAnalyticsSummary(days),
		withUsers ? getUserAnalytics() : Promise.resolve(undefined),
	])
	return ok({ summary, ...(users ? { users } : {}) })
})
