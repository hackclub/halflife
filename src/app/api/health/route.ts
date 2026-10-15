import { NextResponse } from "next/server"
import prisma from "@/lib/prisma"

// Orchard's healthcheck and the container's HEALTHCHECK both point here. Touching Postgres means a pod with a dead database is marked unhealthy instead of serving errors for every request.
export const dynamic = "force-dynamic"

export async function GET(): Promise<NextResponse> {
	// A pod with no auth secret boots, passes a database-only healthcheck, and 500s on every page that touches auth. Fail the check instead, so the orchestrator sees the misconfiguration rather than a healthy-looking pod.
	const missing = ["DATABASE_URL", "BETTER_AUTH_SECRET"].filter(name => !process.env[name])
	if (missing.length > 0) {
		console.error(`[health] missing required configuration: ${missing.join(", ")}`)
		return NextResponse.json({ error: "missing configuration", ok: false }, { status: 503 })
	}

	try {
		await prisma.$queryRaw`SELECT 1`
		return NextResponse.json({ ok: true })
	} catch (err) {
		console.error("[health] database check failed:", err)
		return NextResponse.json({ error: "database unreachable", ok: false }, { status: 503 })
	}
}
