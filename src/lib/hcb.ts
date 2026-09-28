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
 * `HCB_REFRESH_TOKEN`), with the app invited to the org as a manager. The app
 * needs `card_grants:write` to top up, and `card_grants:read` to check what a
 * lost response left behind. Unconfigured, this module refuses rather than
 * calling anything.
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

export interface GrantDisbursement {
  transactionId: string | null
  amountCents: number | null
  memo: string | null
  /** ISO timestamp HCB recorded the disbursement at. */
  createdAt: string | null
}

/**
 * Every disbursement on a card grant, newest first: top-ups land as positive
 * amounts, withdrawals as negative.
 *
 * No pagination: a grant only accumulates one row per top-up/withdrawal, and
 * this exists to spot a top-up whose response was lost before deciding whether
 * to send another.
 */
export async function listCardGrantDisbursements(grantHashid: string): Promise<GrantDisbursement[]> {
  const token = await accessToken()
  const res = await fetch(`${base()}/api/v4/card_grants/${encodeURIComponent(grantHashid)}?expand=disbursements`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new HttpError("INTERNAL", `HCB refused to read the grant (${res.status})`, { detail: body.slice(0, 300) })
  }
  const data = (await res.json()) as { disbursements?: unknown }
  if (!Array.isArray(data.disbursements)) return []
  return data.disbursements.map((raw) => {
    const d = (raw ?? {}) as Record<string, unknown>
    return {
      transactionId: typeof d.transaction_id === "string" ? d.transaction_id : null,
      amountCents: typeof d.amount_cents === "number" ? d.amount_cents : null,
      memo: typeof d.memo === "string" ? d.memo : null,
      createdAt: typeof d.created_at === "string" ? d.created_at : null,
    }
  })
}

/** Allowance for clock skew between our attempt time and HCB's record. */
export const TOPUP_SKEW_MS = 5 * 60_000

/**
 * Decide whether a top-up whose response was lost actually landed.
 *
 * A single disbursement matching the amount at or after the attempt is
 * evidence it did. Several in the window, or a candidate with no usable
 * timestamp, is not something to guess about: an unnecessary retry pays
 * twice, and a skipped one underpays, so ambiguity goes back to a human.
 */
export function reconcileDisbursement(
  disbursements: readonly GrantDisbursement[],
  amountCents: number,
  attemptedAt: Date,
): { kind: "landed"; transactionId: string | null } | { kind: "absent" } | { kind: "ambiguous" } {
  const sameAmount = disbursements.filter((d) => d.amountCents === amountCents)
  if (sameAmount.length === 0) return { kind: "absent" }

  const dated: { at: number; transactionId: string | null }[] = []
  for (const d of sameAmount) {
    const at = d.createdAt ? Date.parse(d.createdAt) : Number.NaN
    if (!Number.isFinite(at)) return { kind: "ambiguous" }
    dated.push({ at, transactionId: d.transactionId })
  }

  const after = attemptedAt.getTime() - TOPUP_SKEW_MS
  const inWindow = dated.filter((d) => d.at >= after)
  if (inWindow.length === 1) return { kind: "landed", transactionId: inWindow[0]?.transactionId ?? null }
  if (inWindow.length > 1) return { kind: "ambiguous" }
  return { kind: "absent" }
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
