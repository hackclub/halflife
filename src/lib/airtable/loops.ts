import "server-only"
import { Phase } from "@/app/generated/prisma/enums"
import { type AirtableRecord, airtableFetch, getAirtableConfig, withRateLimitRetry } from "@/lib/airtable/client"
import { RSVP_TABLE_ID } from "@/lib/airtable/schema"
import { THEMES } from "@/lib/config/program"
import prisma from "@/lib/prisma"

/**
 * The Loops properties on the `Signups` table: what Loops emails people from.
 *
 * Twelve columns, all Half Life's to write: when someone last signed in, when
 * they last logged a journal entry, and one checkbox per program week for
 * whether they have completed that week's first checkpoint. Everything else
 * Half Life tracks stays in Postgres (lib/analytics) — Loops needs these, not
 * the rest.
 *
 * Rows are matched on `email`, case-insensitively, because that is the only
 * identity the table holds. Only existing rows are updated: this table is the
 * landing page's sign-up list, and a row made here would put someone on a
 * Loops list they never joined. Someone whose Half Life email has no row
 * (they signed up on the landing page with another address) is skipped and
 * counted, not created.
 */

const TABLE = RSVP_TABLE_ID

export const LOOPS_FIELDS = {
  email: "email",
  lastLoginAt: "Loops - halfLifeLastLoginAt",
  lastEntryAt: "Loops - halfLifeLastEntryAt",
  week: (n: number) => `Loops - halfLifeWeek${n}Project`,
} as const

const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)

/** What Loops should hold for one person. */
interface LoopsValues {
  email: string
  lastLoginAt: Date | null
  lastEntryAt: Date | null
  /** Week number → completed that week's first checkpoint. */
  weeks: Record<number, boolean>
}

/**
 * Each person's values, from Postgres.
 *
 * A week's box is ticked when its first checkpoint is complete, which differs
 * by kind of week:
 * - week 1's is "Get started", the onboarding;
 * - weeks 2–5 open with "New project", complete once the project has its
 *   description and tier (`namedAt`, see lib/analytics);
 * - weeks 6–10 are the builds of those same projects and open straight into
 *   logging, so their first checkpoint is the first build journal entry.
 */
async function loopsValues(): Promise<LoopsValues[]> {
  const users = await prisma.user.findMany({
    select: {
      email: true,
      lastLoginAt: true,
      onboardingCompletedAt: true,
      themeProjects: {
        where: { deletedAt: null },
        select: {
          theme: true,
          namedAt: true,
          workSessions: {
            where: { deletedAt: null },
            select: { phase: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  })

  return users.map((u) => {
    const weeks: Record<number, boolean> = {}
    for (const def of THEMES) {
      const project = u.themeProjects.find((p) => p.theme === def.id)
      weeks[def.designWeek] = def.designWeek === 1 ? u.onboardingCompletedAt !== null : project?.namedAt != null
      weeks[def.buildWeek] = project?.workSessions.some((s) => s.phase === Phase.BUILD) ?? false
    }
    const lastEntryAt = u.themeProjects
      .map((p) => p.workSessions[0]?.createdAt)
      .filter((d): d is Date => d instanceof Date)
      .reduce<Date | null>((a, b) => (a && a > b ? a : b), null)
    return { email: u.email, lastLoginAt: u.lastLoginAt, lastEntryAt, weeks }
  })
}

/** The Airtable fields for one person, exactly as the table names them. */
function fieldsFor(v: LoopsValues): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    // null clears a date that no longer applies.
    [LOOPS_FIELDS.lastLoginAt]: v.lastLoginAt?.toISOString() ?? null,
    [LOOPS_FIELDS.lastEntryAt]: v.lastEntryAt?.toISOString() ?? null,
  }
  for (const n of WEEKS) fields[LOOPS_FIELDS.week(n)] = v.weeks[n] ?? false
  return fields
}

/** Whether a row already holds these values, so an unchanged row is not rewritten. */
function unchanged(row: AirtableRecord, fields: Record<string, unknown>): boolean {
  return Object.entries(fields).every(([k, want]) => {
    const have = row.fields[k]
    if (typeof want === "boolean") return (have === true) === want
    if (want === null) return have === undefined || have === null || have === ""
    // Airtable returns dates as ISO strings; compare the instants.
    return typeof have === "string" && new Date(have).getTime() === new Date(want as string).getTime()
  })
}

/** Every row of the table, by lowercased email. */
async function signupRows(config: NonNullable<ReturnType<typeof getAirtableConfig>>) {
  const byEmail = new Map<string, AirtableRecord>()
  const want = [LOOPS_FIELDS.email, LOOPS_FIELDS.lastLoginAt, LOOPS_FIELDS.lastEntryAt, ...WEEKS.map(LOOPS_FIELDS.week)]
  const fieldsQs = want.map((f) => `fields%5B%5D=${encodeURIComponent(f)}`).join("&")
  let offset: string | undefined
  do {
    const page = await withRateLimitRetry("listSignups", () =>
      airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
        config,
        `${encodeURIComponent(TABLE)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
      ),
    )
    for (const r of page.records) {
      const email = r.fields[LOOPS_FIELDS.email]
      // First row wins if the list has the same address twice.
      if (typeof email === "string" && !byEmail.has(email.trim().toLowerCase())) {
        byEmail.set(email.trim().toLowerCase(), r)
      }
    }
    offset = page.offset
  } while (offset)
  return byEmail
}

export interface LoopsSyncResult {
  users: number
  matched: number
  /** Half Life users with no row in Signups, by email. */
  unmatched: number
  updated: number
  unchanged: number
  dryRun: boolean
  /** In a dry run, the first few updates that would be sent. */
  preview?: { email: string; fields: Record<string, unknown> }[]
}

/**
 * Bring the Loops columns up to date for everyone. Sends only rows whose
 * values changed, ten per request (Airtable's limit), so an hourly run costs a
 * listing and a handful of writes.
 */
export async function syncLoopsProperties(
  opts: { dryRun?: boolean } = {},
): Promise<LoopsSyncResult | { skipped: string }> {
  const config = getAirtableConfig()
  if (!config) return { skipped: "not_configured" }

  const [values, rows] = await Promise.all([loopsValues(), signupRows(config)])
  const updates: { id: string; email: string; fields: Record<string, unknown> }[] = []
  let matched = 0
  let same = 0
  for (const v of values) {
    const row = rows.get(v.email.trim().toLowerCase())
    if (!row) continue
    matched++
    const fields = fieldsFor(v)
    if (unchanged(row, fields)) same++
    else updates.push({ id: row.id, email: v.email, fields })
  }

  const result: LoopsSyncResult = {
    users: values.length,
    matched,
    unmatched: values.length - matched,
    updated: updates.length,
    unchanged: same,
    dryRun: !!opts.dryRun,
  }
  if (opts.dryRun) {
    result.preview = updates.slice(0, 5).map(({ email, fields }) => ({ email, fields }))
    return result
  }

  for (let i = 0; i < updates.length; i += 10) {
    const batch = updates.slice(i, i + 10)
    await withRateLimitRetry("updateSignups", () =>
      airtableFetch(config, encodeURIComponent(TABLE), {
        method: "PATCH",
        body: JSON.stringify({
          records: batch.map(({ id, fields }) => ({ id, fields })),
          typecast: false,
        }),
      }),
    )
  }
  return result
}
