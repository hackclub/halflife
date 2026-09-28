import "server-only"
import { HttpError } from "@/lib/errors"

/**
 * HCB's v4 API — the authenticated, write-capable one.
 *
 * The v3 API behind /docs/api/v3 is read-only and unauthenticated; it cannot
 * send money. Grants are paid by topping up a participant's existing HCB card
 * grant, which is what `hackclub/dinobags` does with this same API:
 *
 *   POST /api/v4/card_grants/{hashid}/topup?expand=disbursements,user
 *   PUT  /api/v4/organizations/{slug}/transactions/{txn_id}
 *
 * Auth is an OAuth bearer. Either a static `HCB_ACCESS_TOKEN`, or the
 * refresh-token flow (`HCB_CLIENT_ID` / `HCB_CLIENT_SECRET` /
 * `HCB_REFRESH_TOKEN`), with the app invited to the org as a manager.
 * Unconfigured, this module refuses rather than calling anything.
 */

const DEFAULT_BASE = "https://hcb.hackclub.com"

function base(): string {
  return (process.env.HCB_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")
}

export function isHcbConfigured(): boolean {
  const staticToken = Boolean(process.env.HCB_ACCESS_TOKEN)
  const refreshable = Boolean(
    process.env.HCB_CLIENT_ID && process.env.HCB_CLIENT_SECRET && process.env.HCB_REFRESH_TOKEN,
  )
  return Boolean(process.env.HCB_ORG_SLUG && (staticToken || refreshable))
}

let cachedToken: string | null = null

async function accessToken(): Promise<string> {
  if (process.env.HCB_ACCESS_TOKEN) return process.env.HCB_ACCESS_TOKEN
  if (cachedToken) return cachedToken

  const id = process.env.HCB_CLIENT_ID
  const secret = process.env.HCB_CLIENT_SECRET
  const refresh = process.env.HCB_REFRESH_TOKEN
  if (!id || !secret || !refresh) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

  const res = await fetch(`${base()}/api/v4/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      redirect_uri: process.env.HCB_REDIRECT_URI ?? "",
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new HttpError("INTERNAL", `HCB token refresh failed (${res.status})`)

  const data = (await res.json()) as { access_token?: string; refresh_token?: string }
  if (!data.access_token) throw new HttpError("INTERNAL", "HCB token refresh returned no access token")
  cachedToken = data.access_token
  if (data.refresh_token && data.refresh_token !== refresh) {
    // HCB rotates refresh tokens, and an env var cannot be rewritten. This
    // token is used for the life of the process; persisting the new one (see
    // docs) is what keeps the next process able to refresh.
    console.warn("[hcb] refresh token rotated; persist the new value or the next refresh will fail")
  }
  return cachedToken
}

/** A bare hashid, or a grant link on HCB (or the configured base). */
export function parseGrantHashid(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^[A-Za-z0-9]{4,32}$/.test(value)) return value

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  const allowed = new URL(base()).hostname
  if (url.hostname !== allowed && !url.hostname.endsWith(".hackclub.com")) return null
  return /\/grants\/([A-Za-z0-9]{4,32})/.exec(url.pathname)?.[1] ?? null
}

export interface TopUpResult {
  transactionId: string | null
}

export async function topUpCardGrant(grantHashid: string, amountCents: number): Promise<TopUpResult> {
  const token = await accessToken()
  const res = await fetch(
    `${base()}/api/v4/card_grants/${encodeURIComponent(grantHashid)}/topup?expand=disbursements,user`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ amount_cents: amountCents }),
      signal: AbortSignal.timeout(20_000),
    },
  )
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new HttpError("INTERNAL", `HCB refused the top-up (${res.status})`, { detail: body.slice(0, 300) })
  }
  const data = (await res.json()) as { disbursements?: { transaction_id?: string }[] }
  return { transactionId: data.disbursements?.[0]?.transaction_id ?? null }
}

/** Name the resulting transaction, so the org's books say why the money moved. */
export async function memoTransaction(transactionId: string, memo: string): Promise<void> {
  const token = await accessToken()
  const slug = process.env.HCB_ORG_SLUG
  if (!slug) throw new HttpError("NOT_CONFIGURED", "HCB_ORG_SLUG is not set")
  const res = await fetch(
    `${base()}/api/v4/organizations/${encodeURIComponent(slug)}/transactions/${encodeURIComponent(transactionId)}`,
    {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ memo }),
      signal: AbortSignal.timeout(15_000),
    },
  )
  if (!res.ok) throw new HttpError("INTERNAL", `HCB memo update failed (${res.status})`)
}
