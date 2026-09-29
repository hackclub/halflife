import "server-only"
import type { Prisma } from "@/app/generated/prisma/client"
import { HoursSource, Phase, PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import {
  type AirtableConfig,
  type AirtableRecord,
  airtableFetch,
  getAirtableConfig,
  withRateLimitRetry,
} from "@/lib/airtable/client"
import { type FieldDef, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { isAriConfigured, sendSubmissionToAri } from "@/lib/ari"
import { AuditAction, logAuditTx } from "@/lib/audit"
import { TIERS } from "@/lib/config/tiers"
import { HttpError } from "@/lib/errors"
import { encryptPII, isPiiConfigured } from "@/lib/pii"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { trackSideEffect } from "@/lib/side-effects"
import { buildObjectKey, isUploadConfigured, MAX_UPLOAD_BYTES, putObject } from "@/lib/uploads/r2"

/**
 * Bring the warm-up weeks' projects into Half Life.
 *
 * Before the program opened, projects were handed in through a Fillout form
 * that writes rows into the `YSWS Project Submission` table — the same table
 * Half Life's own submissions land in. This reads those rows, files each one
 * on the Warm Up track, creates the submitter's account if they have not
 * signed up yet, and sends the project to Ari so it enters the same review
 * queue as everything submitted through the site.
 *
 * Ownership and idempotency:
 *  - A row Half Life itself wrote (an AIRTABLE_SYNC_SUCCESS audit row carries
 *    its record id) is never imported; it is already a local submission.
 *  - A row that was imported is recorded in an ADMIN_IMPORT_AIRTABLE_PROJECT
 *    audit row keyed by its Airtable record id, so re-running the import only
 *    picks up rows that arrived since.
 *  - Warm-up projects are `Theme.WARMUP`, which is not one of the five season
 *    themes, so they do not occupy a maker's season slots. Unlike a season
 *    theme, `WARMUP` is not unique per maker: the form may have been filled in
 *    more than once, and every row is a different project. Each row therefore
 *    becomes its own project — the `(userId, theme)` unique index is partial
 *    and skips warm-up rows (see prisma/schema.prisma), so a second one does
 *    not collide with the first.
 *
 * Reads go through field NAMES: the Airtable REST API keys `fields` by column
 * name unless `returnFieldsByFieldId` is requested, which nothing here does.
 * The schema's `fld…` ids are for writes (`fieldKey`).
 */

const IMPORT_ACTION = AuditAction.ADMIN_IMPORT_AIRTABLE_PROJECT

export interface WarmupImportOutcome {
  recordId: string
  email: string | null
  status: "imported" | "already_imported" | "skipped" | "failed"
  /** Why it was skipped or failed, in an operator's terms. */
  reason: string | null
  userId: string | null
  themeProjectId: string | null
  /** What the Ari send did, when the row got as far as one. */
  ari: "sent" | "failed" | "not_configured" | "not_attempted"
}

export interface WarmupImportSummary {
  table: string
  fetched: number
  imported: number
  alreadyImported: number
  skipped: number
  failed: number
  ariSent: number
  outcomes: WarmupImportOutcome[]
}

interface ImportActor {
  id: string
  email: string | null
}

// ─── Reading rows ────────────────────────────────────────────────────────────

function rawField(record: AirtableRecord, field: FieldDef): unknown {
  return record.fields[field.name] ?? record.fields[field.id]
}

function readString(record: AirtableRecord, field: FieldDef): string | null {
  const value = rawField(record, field)
  if (typeof value === "string") return value.trim() || null
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function readNumber(record: AirtableRecord, field: FieldDef): number | null {
  const value = rawField(record, field)
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,\s]/g, ""))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readAttachmentUrl(record: AirtableRecord, field: FieldDef): string | null {
  const value = rawField(record, field)
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (entry && typeof entry === "object" && "url" in entry && typeof entry.url === "string" && entry.url) {
      return entry.url
    }
  }
  return null
}

/** The moment the row was created, or now when Airtable did not say. */
function recordDate(record: AirtableRecord): Date {
  const parsed = record.createdTime ? Date.parse(record.createdTime) : Number.NaN
  return Number.isFinite(parsed) ? new Date(parsed) : new Date()
}

function normalizedEmail(raw: string | null): string | null {
  const email = raw?.trim().toLowerCase() ?? ""
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

/** Slack ids and Hackatime ids both arrive as opaque short tokens. */
function cleanExternalId(raw: string | null): string | null {
  const id = raw?.trim() ?? ""
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
}

function phaseForStage(stage: string | null): Phase {
  return stage?.trim().toLowerCase().startsWith("design") ? Phase.DESIGN : Phase.BUILD
}

/**
 * The smallest funding tier that covers what the form asked for, capped at 3.
 *
 * The form's number is a dollar ask, not a tier, and the tier is a reviewer's
 * decision anyway: this only sets `requestedTier`, so the project card has the
 * tier the maker asked for and a design approval has something to start from.
 */
function tierForRequestedFunding(usd: number | null): number {
  if (usd === null || usd <= 0) return TIERS[0].id
  for (const tier of TIERS) {
    if (usd <= tier.grantUsd) return tier.id
  }
  return TIERS[TIERS.length - 1]?.id ?? 3
}

interface ParsedWarmupRow {
  email: string
  name: string | null
  slackId: string | null
  hackatimeId: string | null
  title: string
  description: string | null
  repoUrl: string | null
  journalUrl: string | null
  playableUrl: string | null
  lapseLinks: string | null
  screenshotUrl: string | null
  phase: Phase
  hours: number | null
  requestedFunding: number | null
  createdAt: Date
  address: {
    line1: string | null
    line2: string | null
    city: string | null
    state: string | null
    zip: string | null
    country: string | null
    birthday: string | null
  }
}

function parseRow(record: AirtableRecord): { ok: true; row: ParsedWarmupRow } | { ok: false; reason: string } {
  const f = YSWS_SUBMISSION.fields
  const email = normalizedEmail(readString(record, f.email))
  if (!email) return { ok: false, reason: "the row has no usable email address" }
  const title = readString(record, f.projectName)
  if (!title) return { ok: false, reason: "the row has no project name" }

  const first = readString(record, f.firstName)
  const last = readString(record, f.lastName)
  const name = [first, last].filter(Boolean).join(" ").trim() || null
  const hours = readNumber(record, f.hoursSelfReported)

  return {
    ok: true,
    row: {
      email,
      name,
      slackId: cleanExternalId(readString(record, f.slackId)),
      hackatimeId: cleanExternalId(readString(record, f.hackatimeId)),
      title,
      description: readString(record, f.description),
      // A warm-up form's "Code URL" is the repo; the playable link is a
      // fallback so a project without one still has something a reviewer and
      // the repo checks can open.
      repoUrl: readString(record, f.codeUrl) ?? readString(record, f.playableUrl),
      journalUrl: readString(record, f.journalUrl),
      playableUrl: readString(record, f.playableUrl),
      lapseLinks: readString(record, f.lapseLinks),
      screenshotUrl: readAttachmentUrl(record, f.screenshot),
      phase: phaseForStage(readString(record, f.stage)),
      hours: hours !== null && hours > 0 ? Math.round(hours * 100) / 100 : null,
      requestedFunding: readNumber(record, f.requestedFunding),
      createdAt: recordDate(record),
      address: {
        line1: readString(record, f.addressLine1),
        line2: readString(record, f.addressLine2),
        city: readString(record, f.city),
        state: readString(record, f.state),
        zip: readString(record, f.zip),
        country: readString(record, f.country),
        birthday: readString(record, f.birthday),
      },
    },
  }
}

async function listWarmupRecords(config: AirtableConfig): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined
  do {
    const params = new URLSearchParams({ pageSize: "100" })
    if (offset) params.set("offset", offset)
    const page = await withRateLimitRetry("listWarmupProjects", () =>
      airtableFetch<{ records?: AirtableRecord[]; offset?: string }>(
        config,
        `${YSWS_SUBMISSION.tableId}?${params.toString()}`,
      ),
    )
    records.push(...(page.records ?? []))
    offset = page.offset
  } while (offset)
  return records
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/** Airtable record id → the local project it was imported as. */
async function importedRecordIds(): Promise<Map<string, string>> {
  const rows = await prisma.auditLog.findMany({
    where: { action: IMPORT_ACTION },
    select: { targetId: true, metadata: true },
  })
  const out = new Map<string, string>()
  for (const row of rows) {
    const meta = row.metadata as { airtableRecordId?: unknown } | null
    if (row.targetId && typeof meta?.airtableRecordId === "string") out.set(meta.airtableRecordId, row.targetId)
  }
  return out
}

/** Rows Half Life's own submit flow wrote, which are already local submissions. */
async function halfLifeWrittenRecordIds(): Promise<Set<string>> {
  const rows = await prisma.auditLog.findMany({
    where: { action: AuditAction.AIRTABLE_SYNC_SUCCESS },
    select: { metadata: true },
  })
  const out = new Set<string>()
  for (const row of rows) {
    const meta = row.metadata as { recordId?: unknown } | null
    if (typeof meta?.recordId === "string") out.add(meta.recordId)
  }
  return out
}

// ─── Cover re-hosting ────────────────────────────────────────────────────────

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/**
 * Airtable attachment URLs are signed and expire in about two hours, so a
 * cover has to be copied into R2 to outlive the import. Best-effort: a missing
 * cover is cosmetic and must not fail the project.
 */
async function rehostScreenshot(userId: string, url: string): Promise<string | null> {
  if (!isUploadConfigured()) return null
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const contentType = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? ""
    const ext = IMAGE_EXT[contentType]
    if (!ext) return null
    const body = Buffer.from(await res.arrayBuffer())
    if (body.byteLength === 0 || body.byteLength > MAX_UPLOAD_BYTES) return null
    const key = buildObjectKey(userId, "covers", ext)
    await putObject(key, body, contentType)
    return key
  } catch (err) {
    console.warn("[airtable] could not re-host a warm-up screenshot:", err)
    return null
  }
}

// ─── The import itself ───────────────────────────────────────────────────────

type ImportedRecord =
  | { status: "imported"; reason: string | null; userId: string; themeProjectId: string }
  | { status: "skipped"; reason: string; userId: null; themeProjectId: string | null }

function encryptedPiiFields(row: ParsedWarmupRow): Partial<Prisma.UserCreateInput> {
  if (!isPiiConfigured()) return {}
  const { address } = row
  const out: Partial<Prisma.UserCreateInput> = {}
  if (address.line1) out.encryptedAddressStreet = encryptPII(address.line1)
  if (address.line2) out.encryptedAddressLine2 = encryptPII(address.line2)
  if (address.city) out.encryptedAddressCity = encryptPII(address.city)
  if (address.state) out.encryptedAddressState = encryptPII(address.state)
  if (address.zip) out.encryptedAddressZip = encryptPII(address.zip)
  if (address.country) out.encryptedAddressCountry = encryptPII(address.country)
  if (address.birthday) out.encryptedBirthday = encryptPII(address.birthday)
  return out
}

/**
 * Claim the row for one person and build their warm-up project, session and
 * submission in one transaction.
 *
 * The advisory lock is keyed on the email, so two rows for the same maker, or
 * an admin double-clicking the button, serialize instead of racing each other
 * into a duplicate account. Every row that gets here is a project of its own:
 * the form may have been filled in more than once, and warm-up projects
 * deliberately do not hold a unique slot. Idempotency per Airtable row is
 * re-checked under that lock, because the caller's "not imported yet" read
 * happened before the transaction and a second run can hold the same snapshot.
 * Everything after the transaction — the cover copy and the Ari send — is
 * external and idempotent enough not to belong inside it.
 */
async function importRow(
  record: AirtableRecord,
  row: ParsedWarmupRow,
  actor: ImportActor,
  programTimezone: string,
): Promise<ImportedRecord> {
  const createdAt = row.createdAt
  const phase = row.phase

  const journalParts = [
    row.description,
    row.journalUrl ? `Journal: ${row.journalUrl}` : null,
    row.playableUrl ? `Playable: ${row.playableUrl}` : null,
    row.lapseLinks ? `Timelapse: ${row.lapseLinks}` : null,
  ].filter((part): part is string => !!part)

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`warmup-import:${row.email}`}, 0))`

      // Two runs of the same click (two admins, two tabs) both read their
      // "not imported yet" snapshot before either transaction started. Since
      // warm-up rows are no longer held unique by `(userId, theme)`, the
      // insert below would happily make a second project for one Airtable
      // row; this re-read under the lock is what keeps a row to one project.
      const raced = await tx.auditLog.findFirst({
        where: { action: IMPORT_ACTION, metadata: { path: ["airtableRecordId"], equals: record.id } },
        select: { targetId: true },
      })
      if (raced?.targetId) {
        return {
          status: "skipped" as const,
          reason: "another import run filed this row first",
          userId: null,
          themeProjectId: raced.targetId,
        }
      }

      let user = await tx.user.findFirst({
        where: { email: { equals: row.email, mode: "insensitive" } },
        select: { id: true },
      })
      let createdUser = false
      if (!user) {
        const slackTaken = row.slackId
          ? await tx.user.findFirst({ where: { slackId: row.slackId }, select: { id: true } })
          : null
        const hackatimeTaken = row.hackatimeId
          ? await tx.user.findFirst({ where: { hackatimeUserId: row.hackatimeId }, select: { id: true } })
          : null
        user = await tx.user.create({
          data: {
            email: row.email,
            name: row.name,
            emailVerified: false,
            joinedProgramAt: createdAt,
            ...(row.slackId && !slackTaken ? { slackId: row.slackId } : {}),
            ...(row.hackatimeId && !hackatimeTaken ? { hackatimeUserId: row.hackatimeId } : {}),
            ...encryptedPiiFields(row),
          },
          select: { id: true },
        })
        createdUser = true
      }

      const project = await tx.themeProject.create({
        data: {
          userId: user.id,
          theme: Theme.WARMUP,
          title: row.title,
          description: row.description,
          githubRepo: row.repoUrl,
          requestedTier: tierForRequestedFunding(row.requestedFunding),
          namedAt: createdAt,
          createdAt,
          ...(phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : {}),
          ...(phase === Phase.BUILD ? { buildStatus: PhaseStatus.in_review } : {}),
        },
        select: { id: true },
      })

      if (journalParts.length > 0 || row.hours !== null) {
        await tx.workSession.create({
          data: {
            themeProjectId: project.id,
            phase,
            title: `${row.title} — warm-up submission`,
            content: journalParts.length > 0 ? journalParts.join("\n\n") : null,
            hoursClaimed: row.hours ?? 0,
            hoursSource: HoursSource.MANUAL,
            weekNumber: 0,
            effectiveDate: effectiveDateFor(createdAt, programTimezone),
            createdAt,
          },
        })
      }

      await tx.phaseSubmission.create({
        data: {
          themeProjectId: project.id,
          phase,
          submittedInWeek: 0,
          scheduledWeek: 0,
          onTime: false,
          createdAt,
        },
      })

      // The row already exists in the table — it is where this import came
      // from — so record its record id the same way a successful write does.
      // That is what keeps the retry job from posting a second copy, lets a
      // resubmission update this row instead of creating one, and lets an
      // unsubmit remove it (see lib/airtable/sync). Nothing was written to
      // Airtable here; `imported` says where the id came from.
      await logAuditTx(tx, {
        action: AuditAction.AIRTABLE_SYNC_SUCCESS,
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "ThemeProject",
        targetId: project.id,
        metadata: { phase, recordId: record.id, imported: true, sourceTable: YSWS_SUBMISSION.tableId },
      })

      await logAuditTx(tx, {
        action: IMPORT_ACTION,
        actorId: actor.id,
        actorEmail: actor.email,
        targetType: "ThemeProject",
        targetId: project.id,
        metadata: {
          airtableRecordId: record.id,
          sourceTable: YSWS_SUBMISSION.tableId,
          email: row.email,
          phase,
          createdUser,
        },
      })

      return {
        status: "imported" as const,
        reason: createdUser ? "created the maker's account" : null,
        userId: user.id,
        themeProjectId: project.id,
      }
    },
    { timeout: 30_000 },
  )
}

async function sendToAri(
  themeProjectId: string,
  phase: Phase,
  actor: ImportActor,
): Promise<WarmupImportOutcome["ari"]> {
  if (!isAriConfigured()) return "not_configured"
  const result = await trackSideEffect(
    "ari",
    {
      actorId: actor.id,
      actorEmail: actor.email,
      targetType: "ThemeProject",
      targetId: themeProjectId,
      metadata: { phase, warmupImport: true },
    },
    () => sendSubmissionToAri(themeProjectId, phase),
  )
  return result ? "sent" : "failed"
}

/**
 * Import every warm-up row that has not been imported yet.
 *
 * Sequential on purpose: each row can download a screenshot and call Ari, and
 * the Airtable client already rate-limits at the base's 5 req/s. `getProgramSettings`
 * runs up front because the singleton row may need creating, which a
 * transaction must not do while it holds a lock.
 */
export async function importWarmupProjects(actor: ImportActor): Promise<WarmupImportSummary> {
  const config = getAirtableConfig()
  if (!config) throw new HttpError("NOT_CONFIGURED", "Airtable is not configured on this deployment")

  const [records, imported, written, settings] = await Promise.all([
    listWarmupRecords(config),
    importedRecordIds(),
    halfLifeWrittenRecordIds(),
    getProgramSettings(),
  ])

  const outcomes: WarmupImportOutcome[] = []
  for (const record of records) {
    const base: WarmupImportOutcome = {
      recordId: record.id,
      email: null,
      status: "failed",
      reason: null,
      userId: null,
      themeProjectId: null,
      ari: "not_attempted",
    }

    if (imported.has(record.id)) {
      outcomes.push({ ...base, status: "already_imported", themeProjectId: imported.get(record.id) ?? null })
      continue
    }
    if (written.has(record.id)) {
      outcomes.push({ ...base, status: "skipped", reason: "Half Life already writes this Airtable row" })
      continue
    }

    const parsed = parseRow(record)
    if (!parsed.ok) {
      outcomes.push({ ...base, status: "skipped", reason: parsed.reason })
      continue
    }

    try {
      const result = await importRow(record, parsed.row, actor, settings.programTimezone)
      const outcome: WarmupImportOutcome = {
        ...base,
        email: parsed.row.email,
        status: result.status,
        reason: result.reason,
        userId: result.userId,
        themeProjectId: result.themeProjectId,
      }

      if (result.status === "imported") {
        if (parsed.row.screenshotUrl) {
          const key = await rehostScreenshot(result.userId, parsed.row.screenshotUrl)
          if (key) {
            await prisma.themeProject.update({ where: { id: result.themeProjectId }, data: { coverImageKey: key } })
          }
        }
        outcome.ari = await sendToAri(result.themeProjectId, parsed.row.phase, actor)
      }

      outcomes.push(outcome)
    } catch (err) {
      console.error(`[airtable] warm-up import failed for ${record.id}:`, err)
      outcomes.push({
        ...base,
        email: parsed.row.email,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const count = (status: WarmupImportOutcome["status"]) => outcomes.filter((o) => o.status === status).length
  return {
    table: YSWS_SUBMISSION.tableId,
    fetched: records.length,
    imported: count("imported"),
    alreadyImported: count("already_imported"),
    skipped: count("skipped"),
    failed: count("failed"),
    ariSent: outcomes.filter((o) => o.ari === "sent").length,
    outcomes,
  }
}
