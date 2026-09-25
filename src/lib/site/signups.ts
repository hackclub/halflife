import { appendFile, mkdir, readFile } from "node:fs/promises"
import path from "node:path"

/**
 * Signup capture.
 *
 * Three sinks, chosen by environment so the same route works locally and in
 * production without a code change:
 *
 *   AIRTABLE_API_KEY +   Write straight to the "Half Life" base
 *   AIRTABLE_BASE_ID     (appVGSvooOShD3qtC), table AIRTABLE_TABLE_NAME,
 *                        else AIRTABLE_RSVP_TABLE_ID — the Signups table,
 *                        which has `email`, `ip`, `referred_by`,
 *                        `utm_source`, `utm_medium`, `utm_campaign` and
 *                        `Loops - halfLifeReferralNumber` (text). The token
 *                        needs data.records:read/write scope on that base.
 *   SIGNUP_WEBHOOK_URL   POST the full entry (email, ip, source, at,
 *                        referralCode, ref, utmSource, utmMedium,
 *                        utmCampaign) to your list provider, form endpoint,
 *                        Sheets relay, or queue. Set SIGNUP_WEBHOOK_TOKEN to
 *                        send a bearer header.
 *   (unset)              append JSON Lines to ./data/signups.jsonl — fine for
 *                        local development and any host with a writable disk,
 *                        NOT durable on serverless.
 *
 * referralCode is a running count ("1", "2", "3", ...) of signups in
 * whichever sink is active, assigned once per email and handed back
 * unchanged on repeat signups.
 */

const STORE_DIR = path.join(process.cwd(), "data")
const STORE_FILE = path.join(STORE_DIR, "signups.jsonl")

const EMAIL = /^[^\s@,;:<>()[\]\\"]+@[^\s@.,;:<>()[\]\\"]+(\.[^\s@.,;:<>()[\]\\"]+)+$/

export type SignupResult =
  | { ok: true; duplicate: boolean; referralCode: string }
  | { ok: false; error: string; status: number }

export type SignupMeta = {
  source?: string
  ref?: string | null
  utmSource?: string | null
  utmMedium?: string | null
  utmCampaign?: string | null
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const email = raw.trim().toLowerCase()
  if (email.length < 6 || email.length > 254) return null
  if (!EMAIL.test(email)) return null
  return email
}

/**
 * Fetches every record's `referral_code` isn't an option at scale, but
 * counting record ids is cheap — request just the `email` field (Airtable
 * rejects an empty field name outright) so each page carries almost nothing
 * else. The count is a snapshot, not a lock, so two signups landing in the
 * same instant can in principle claim the same ordinal; acceptable here
 * given the existing rate limit and the low stakes of a referral number
 * colliding.
 */
async function countAirtableRecords(url: string, headers: Record<string, string>): Promise<number> {
  let count = 0
  let offset: string | undefined
  do {
    const params = new URLSearchParams({ pageSize: "100", "fields[]": "email" })
    if (offset) params.set("offset", offset)
    const res = await fetch(`${url}?${params.toString()}`, { headers })
    if (!res.ok) {
      throw new Error(`${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as { records?: unknown[]; offset?: string }
    count += data.records?.length ?? 0
    offset = data.offset
  } while (offset)
  return count
}

/**
 * In-memory only — resets on cold start and isn't shared across instances,
 * so it's a rough ordinal rather than a guaranteed-unique one. Unlike
 * Airtable or the JSONL file, a webhook sink has nothing local to count
 * signups from.
 */
let webhookSequence = 0

export async function recordSignup(email: string, ip = "unknown", meta: SignupMeta = {}): Promise<SignupResult> {
  const { source = "landing", ref = null, utmSource = null, utmMedium = null, utmCampaign = null } = meta

  const airtableToken = process.env.AIRTABLE_API_KEY
  const airtableBase = process.env.AIRTABLE_BASE_ID

  if (airtableToken && airtableBase) {
    // The Signups table. It used to default to "Table 1", which is not in
    // the base, so any deployment without AIRTABLE_TABLE_NAME failed every
    // signup; the platform already names this table in AIRTABLE_RSVP_TABLE_ID.
    const table = encodeURIComponent(process.env.AIRTABLE_TABLE_NAME ?? process.env.AIRTABLE_RSVP_TABLE_ID ?? "Signups")
    const url = `https://api.airtable.com/v0/${airtableBase}/${table}`
    const headers = {
      "content-type": "application/json",
      authorization: `Bearer ${airtableToken}`,
    }

    // Airtable has no unique-field constraint to lean on, so duplicates are
    // caught with a lookup before the write — same contract the other two
    // sinks give the caller.
    const filter = encodeURIComponent(`LOWER({email})="${email}"`)
    const lookup = await fetch(`${url}?filterByFormula=${filter}&maxRecords=1`, {
      headers,
    })

    if (!lookup.ok) {
      console.error(`Airtable lookup failed: ${lookup.status} ${await lookup.text()}`)
      return {
        ok: false,
        status: 502,
        error: "We couldn't reach the signup list. Try again in a moment.",
      }
    }

    const found = (await lookup.json()) as {
      records?: Array<{ fields?: Record<string, unknown> }>
    }
    if ((found.records?.length ?? 0) > 0) {
      // The column the number is written to below; there is no
      // `referral_code`, so reading that handed returning people a blank.
      const existing = found.records?.[0]?.fields?.["Loops - halfLifeReferralNumber"]
      return {
        ok: true,
        duplicate: true,
        referralCode: existing == null ? "" : String(existing),
      }
    }

    let referralCode: string
    try {
      referralCode = String((await countAirtableRecords(url, headers)) + 1)
    } catch (err) {
      console.error(`Airtable count failed: ${err}`)
      return {
        ok: false,
        status: 502,
        error: "We couldn't reach the signup list. Try again in a moment.",
      }
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        fields: {
          email,
          ip,
          "Loops - halfLifeReferralNumber": referralCode,
          referred_by: ref ?? undefined,
          utm_source: utmSource ?? undefined,
          utm_medium: utmMedium ?? undefined,
          utm_campaign: utmCampaign ?? undefined,
        },
      }),
    })

    if (!response.ok) {
      console.error(`Airtable create failed: ${response.status} ${await response.text()}`)
      return {
        ok: false,
        status: 502,
        error: "We couldn't reach the signup list. Try again in a moment.",
      }
    }
    return { ok: true, duplicate: false, referralCode }
  }

  const webhook = process.env.SIGNUP_WEBHOOK_URL

  if (webhook) {
    const referralCode = String(++webhookSequence)
    const entry = {
      email,
      ip,
      source,
      referralCode,
      ref,
      utmSource,
      utmMedium,
      utmCampaign,
    }
    const token = process.env.SIGNUP_WEBHOOK_TOKEN
    const response = await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(entry),
    })

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        error: "We couldn't reach the signup list. Try again in a moment.",
      }
    }
    return { ok: true, duplicate: false, referralCode }
  }

  await mkdir(STORE_DIR, { recursive: true })

  let duplicate = false
  let referralCode = ""
  let lineCount = 0
  try {
    const lines = (await readFile(STORE_FILE, "utf8")).split("\n").filter(Boolean)
    lineCount = lines.length
    const match = lines.find((line) => line.includes(`"email":"${email}"`))
    if (match) {
      duplicate = true
      try {
        referralCode = (JSON.parse(match) as { referralCode?: string }).referralCode ?? ""
      } catch {
        referralCode = ""
      }
    }
  } catch {
    // First signup — no file yet.
  }

  if (!duplicate) {
    referralCode = String(lineCount + 1)
    const entry = {
      email,
      ip,
      source,
      referralCode,
      ref,
      utmSource,
      utmMedium,
      utmCampaign,
    }
    await appendFile(STORE_FILE, `${JSON.stringify(entry)}\n`, "utf8")
  }

  return { ok: true, duplicate, referralCode }
}

/* ── Coarse per-instance rate limit ──────────────────────────────────────
   Enough to stop a bored browser tab hammering the endpoint. For real abuse
   protection put Vercel BotID or the WAF in front of the route. */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 8
const hits = new Map<string, number[]>()

export function rateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS)
  recent.push(now)
  hits.set(key, recent)

  if (hits.size > 5_000) hits.clear()
  return recent.length > MAX_PER_WINDOW
}
