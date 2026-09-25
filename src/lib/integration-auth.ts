import "server-only"
import { timingSafeEqual } from "node:crypto"
import type { NextRequest, NextResponse } from "next/server"
import { fail, type ApiErrorBody } from "@/lib/api"

function matches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on a length mismatch, so check length first. The
  // length of a bearer token is not the secret.
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Returns null when the caller is authorised, or the response to send back.
 *
 * An unset env var yields 503, never an open route: a machine endpoint that
 * silently stops checking its key is worse than one that stops working.
 */
export function requireBearerAuth(request: NextRequest, envVars: string[]): NextResponse<ApiErrorBody> | null {
  const expected = envVars.map((v) => process.env[v]).filter((v): v is string => !!v)
  if (expected.length === 0) {
    return fail("NOT_CONFIGURED", `Set one of ${envVars.join(", ")} to enable this endpoint`)
  }

  const header = request.headers.get("authorization") ?? ""
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match?.[1]) return fail("UNAUTHENTICATED", "Missing bearer token")

  const presented = match[1].trim()
  if (!expected.some((token) => matches(presented, token))) {
    return fail("UNAUTHENTICATED", "Invalid bearer token")
  }
  return null
}

export function requireIntegrationAuth(request: NextRequest) {
  return requireBearerAuth(request, ["INTEGRATION_API_KEY"])
}

/** The read-only export accepts a narrower per-partner key as well. */
export function requireExportAuth(request: NextRequest) {
  return requireBearerAuth(request, ["EXPORT_API_KEY", "INTEGRATION_API_KEY"])
}
