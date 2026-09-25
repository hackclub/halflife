import "server-only"
import prisma from "@/lib/prisma"
import {
  airtableFetch,
  escapeAirtableValue,
  getAirtableConfig,
  withRateLimitRetry,
  type AirtableRecord,
} from "@/lib/airtable/client"
import { RSVP, fieldKey, formulaRef, toFields } from "@/lib/airtable/schema"

export interface RsvpInput {
  email: string
  firstName?: string | null
  lastName?: string | null
  pronouns?: string | null
  ip?: string | null
  utmSource?: string | null
  signupPage?: string | null
  referredBy?: string | null
}

/**
 * Write-behind, not write-through.
 *
 * Airtable is the funnel's source of truth but it rate-limits and it goes down.
 * Every RSVP lands in Postgres first and is drained by a job, so a
 * marketing-page signup never fails because a third party is having a bad day.
 * Stasis calls Airtable synchronously here and only falls back to Postgres when
 * someone flips an env var by hand.
 */
export async function bufferRsvp(input: RsvpInput): Promise<{ buffered: true }> {
  const email = input.email.trim().toLowerCase()
  await prisma.rsvpBuffer.upsert({
    where: { email },
    create: {
      email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      pronouns: input.pronouns ?? null,
      ip: input.ip ?? null,
      utmSource: input.utmSource ?? null,
      signupPage: input.signupPage ?? null,
      referredBy: input.referredBy ?? null,
    },
    // Re-RSVPing must not clobber attribution captured the first time.
    update: {
      firstName: input.firstName ?? undefined,
      lastName: input.lastName ?? undefined,
      pronouns: input.pronouns ?? undefined,
      syncedToAirtable: false,
    },
  })
  return { buffered: true }
}

/** Called from the signup hook once a real account exists. */
export async function bufferRsvpForUser(userId: string, email: string, name: string | null): Promise<void> {
  const [firstName, ...rest] = (name ?? "").trim().split(/\s+/)
  await prisma.rsvpBuffer.upsert({
    where: { email: email.trim().toLowerCase() },
    create: {
      email: email.trim().toLowerCase(),
      firstName: firstName || null,
      lastName: rest.length > 0 ? rest.join(" ") : null,
      userId,
      finishedAccountCreation: true,
    },
    update: { userId, finishedAccountCreation: true, syncedToAirtable: false },
  })
}

export interface DrainResult {
  attempted: number
  created: number
  updated: number
  failed: number
  skipped?: string
}

/**
 * Push buffered RSVPs upstream. Idempotent and safe to run on a schedule:
 * anything that fails stays unsynced with an incremented attempt count, and
 * the index on (syncedToAirtable, syncAttempts, createdAt) makes finding them
 * a single scan.
 */
export async function drainRsvpBuffer(limit = 50, opts: { dryRun?: boolean } = {}): Promise<DrainResult> {
  const config = getAirtableConfig()
  if (!config) return { attempted: 0, created: 0, updated: 0, failed: 0, skipped: "not_configured" }

  const pending = await prisma.rsvpBuffer.findMany({
    where: { syncedToAirtable: false, syncAttempts: { lt: 10 } },
    orderBy: { createdAt: "asc" },
    take: limit,
  })

  const result: DrainResult = { attempted: pending.length, created: 0, updated: 0, failed: 0 }
  if (opts.dryRun) return result

  for (const row of pending) {
    try {
      const fields = toFields(RSVP.fields, {
        email: row.email,
        firstName: row.firstName ?? undefined,
        lastName: row.lastName ?? undefined,
        pronouns: row.pronouns ?? undefined,
        ip: row.ip ?? undefined,
        utmSource: row.utmSource ?? undefined,
        signupPage: row.signupPage ?? undefined,
        referredBy: row.referredBy ?? undefined,
        finishedAccountCreation: row.finishedAccountCreation,
        userId: row.userId ?? undefined,
      })

      let recordId = row.airtableRecordId
      if (recordId) {
        // Once the row exists upstream, updates are a patch by id rather than a
        // formula search.
        await withRateLimitRetry("updateRsvp", () =>
          airtableFetch(config, `${RSVP.tableId}/${recordId}`, {
            method: "PATCH",
            body: JSON.stringify({ fields }),
          }),
        )
        result.updated++
      } else {
        const upserted = await withRateLimitRetry("upsertRsvp", () =>
          airtableFetch<{ records: AirtableRecord[]; updatedRecords?: string[] }>(config, RSVP.tableId, {
            method: "PATCH",
            body: JSON.stringify({
              performUpsert: { fieldsToMergeOn: [fieldKey(RSVP.fields.email)] },
              records: [{ fields }],
              typecast: false,
            }),
          }),
        )
        recordId = upserted.records[0]?.id ?? null
        if (upserted.updatedRecords?.length) result.updated++
        else result.created++
      }

      await prisma.rsvpBuffer.update({
        where: { id: row.id },
        data: {
          syncedToAirtable: true,
          syncedAt: new Date(),
          airtableRecordId: recordId,
          lastSyncError: null,
        },
      })
    } catch (err) {
      result.failed++
      await prisma.rsvpBuffer.update({
        where: { id: row.id },
        data: {
          syncAttempts: { increment: 1 },
          lastSyncError: err instanceof Error ? err.message : String(err),
        },
      })
    }
  }
  return result
}

/** Total RSVPs, for the landing page counter. */
export async function getRsvpCount(): Promise<number> {
  return prisma.rsvpBuffer.count()
}

/** Look one up upstream. Used by ops tooling, not by request paths. */
export async function findRsvpByEmail(email: string): Promise<AirtableRecord | null> {
  const config = getAirtableConfig()
  if (!config) return null
  const formula = `${formulaRef(RSVP.fields.email)} = '${escapeAirtableValue(email)}'`
  const result = await withRateLimitRetry("findRsvpByEmail", () =>
    airtableFetch<{ records: AirtableRecord[] }>(
      config,
      `${RSVP.tableId}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`,
    ),
  )
  return result.records[0] ?? null
}
