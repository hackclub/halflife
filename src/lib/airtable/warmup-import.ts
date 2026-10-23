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
import { lockKey } from "@/lib/locks"
import { round2 } from "@/lib/money"
import { encryptPII, isPiiConfigured } from "@/lib/pii"
import prisma from "@/lib/prisma"
import { effectiveDateFor, getProgramSettings } from "@/lib/program"
import { normalizeRepo } from "@/lib/repo"
import { trackSideEffect } from "@/lib/side-effects"
import { buildObjectKey, isUploadConfigured, MAX_UPLOAD_BYTES, putObject } from "@/lib/uploads/r2"
import { fetchRemoteImage } from "@/lib/uploads/remote"

/**
 * Bring the warm-up weeks' projects into Half Life.
 *
 * Before the program opened, projects were handed in through a Fillout form that writes rows into the `YSWS Project Submission` table – the same table Half Life's own submissions land in. This reads those rows, files each one on the Warm Up track, creates the submitter's account if they have not signed up yet, and sends the project to Ari so it enters the same review queue as everything submitted through the site.
 *
 * Ownership and idempotency:
 * - A row Half Life itself wrote (an AIRTABLE_SYNC_SUCCESS audit row carries its record id) is never imported; it is already a local submission.
 * - A row that was imported is recorded in an ADMIN_IMPORT_AIRTABLE_PROJECT audit row keyed by its Airtable record id, so re-running the import only picks up rows that arrived since.
 * - Warm-up projects are `Theme.WARMUP`, which is not one of the five season themes, so they do not occupy a maker's season slots. Unlike a season theme, `WARMUP` is not unique per maker: the form may have been filled in more than once, and every row is a different project. Each row therefore becomes its own project – the `(userId, theme)` unique index is partial and skips warm-up rows (see prisma/schema.prisma), so a second one does not collide with the first.
 *
 * Reads go through field NAMES: the Airtable REST API keys `fields` by column name unless `returnFieldsByFieldId` is requested, which nothing here does. The schema's `fld…` ids are for writes (`fieldKey`).
 */

const IMPORT_ACTION = AuditAction.ADMIN_IMPORT_AIRTABLE_PROJECT

interface WarmupImportOutcome {
	/** What the Ari send did, when the row got as far as one. */
	ari: "sent" | "failed" | "not_configured" | "not_attempted"
	email: string | null
	/** Why it was skipped or failed, in an operator's terms. */
	reason: string | null
	recordId: string
	status: "imported" | "already_imported" | "skipped" | "failed"
	themeProjectId: string | null
	userId: string | null
}

interface WarmupImportSummary {
	alreadyImported: number
	ariSent: number
	failed: number
	fetched: number
	imported: number
	outcomes: WarmupImportOutcome[]
	skipped: number
	table: string
}

interface ImportActor {
	email: string | null
	id: string
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
		const parsed = Number(value.replaceAll(/[$,\s]/g, ""))
		return Number.isFinite(parsed) ? parsed : null
	}
	return null
}

function readAttachmentUrl(record: AirtableRecord, field: FieldDef): string | null {
	const value = rawField(record, field)
	if (!Array.isArray(value)) return null
	for (const entry of value as unknown[])
		if (entry && typeof entry === "object" && "url" in entry && typeof entry.url === "string" && entry.url)
			return entry.url

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
 * The form's number is a dollar ask, not a tier, and the tier is a reviewer's decision anyway: this only sets `requestedTier`, so the project card has the tier the maker asked for and a design approval has something to start from.
 */
function tierForRequestedFunding(usd: number | null): number {
	if (usd === null || usd <= 0) return TIERS[0].id
	for (const tier of TIERS) if (usd <= tier.grantUsd) return tier.id
	return TIERS.at(-1)?.id ?? 3
}

interface ParsedWarmupRow {
	address: {
		line1: string | null
		line2: string | null
		city: string | null
		state: string | null
		zip: string | null
		country: string | null
		birthday: string | null
	}
	createdAt: Date
	description: string | null
	email: string
	hackatimeId: string | null
	hours: number | null
	journalUrl: string | null
	lapseLinks: string | null
	name: string | null
	phase: Phase
	playableUrl: string | null
	repoUrl: string | null
	requestedFunding: number | null
	screenshotUrl: string | null
	slackId: string | null
	title: string
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
			address: {
				birthday: readString(record, f.birthday),
				city: readString(record, f.city),
				country: readString(record, f.country),
				line1: readString(record, f.addressLine1),
				line2: readString(record, f.addressLine2),
				state: readString(record, f.state),
				zip: readString(record, f.zip),
			},
			createdAt: recordDate(record),
			description: readString(record, f.description),
			email,
			hackatimeId: cleanExternalId(readString(record, f.hackatimeId)),
			hours: hours !== null && hours > 0 ? round2(hours) : null,
			journalUrl: readString(record, f.journalUrl),
			lapseLinks: readString(record, f.lapseLinks),
			name,
			phase: phaseForStage(readString(record, f.stage)),
			playableUrl: readString(record, f.playableUrl),
			// A warm-up form's "Code URL" is the repo; the playable link is a fallback so a project without one still has something a reviewer and the repo checks can open.
			repoUrl: readString(record, f.codeUrl) ?? readString(record, f.playableUrl),
			requestedFunding: readNumber(record, f.requestedFunding),
			screenshotUrl: readAttachmentUrl(record, f.screenshot),
			slackId: cleanExternalId(readString(record, f.slackId)),
			title,
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
		;({ offset } = page)
	} while (offset)
	return records
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/** Airtable record id → the local project it was imported as. */
async function importedRecordIds(): Promise<Map<string, string>> {
	const rows = await prisma.auditLog.findMany({
		select: { metadata: true, targetId: true },
		where: { action: IMPORT_ACTION },
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
		select: { metadata: true },
		where: { action: AuditAction.AIRTABLE_SYNC_SUCCESS },
	})
	const out = new Set<string>()
	for (const row of rows) {
		const meta = row.metadata as { recordId?: unknown } | null
		if (typeof meta?.recordId === "string") out.add(meta.recordId)
	}
	return out
}

// ─── Cover re-hosting ────────────────────────────────────────────────────────

/**
 * Airtable attachment URLs are signed and expire in about two hours, so a cover has to be copied into R2 to outlive the import. Best-effort: a missing cover is cosmetic and must not fail the project.
 *
 * The URL is whatever the imported row held, so it is fetched through the guarded remote-image path (SSRF blocklist, redirect cap, DNS pinning) and its bytes sniffed, rather than a bare fetch that trusts the remote Content-Type.
 */
async function rehostScreenshot(userId: string, url: string): Promise<string | null> {
	if (!isUploadConfigured()) return null
	try {
		const { bytes, ext, contentType } = await fetchRemoteImage(url, MAX_UPLOAD_BYTES)
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) return null
		const key = buildObjectKey(userId, "covers", ext)
		await putObject(key, bytes, contentType)
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
 * Claim the row for one person and build their warm-up project, session and submission in one transaction.
 *
 * The advisory lock is keyed on the email, so two rows for the same maker, or an admin double-clicking the button, serialize instead of racing each other into a duplicate account. Every row that gets here is a project of its own: the form may have been filled in more than once, and warm-up projects deliberately do not hold a unique slot. Idempotency per Airtable row is re-checked under that lock, because the caller's "not imported yet" read happened before the transaction and a second run can hold the same snapshot. Everything after the transaction – the cover copy and the Ari send – is external and idempotent enough not to belong inside it.
 */
function importRow(
	record: AirtableRecord,
	row: ParsedWarmupRow,
	actor: ImportActor,
	programTimezone: string,
): Promise<ImportedRecord> {
	const { createdAt, phase } = row

	const journalParts = [
		row.description,
		row.journalUrl ? `Journal: ${row.journalUrl}` : null,
		row.playableUrl ? `Playable: ${row.playableUrl}` : null,
		row.lapseLinks ? `Timelapse: ${row.lapseLinks}` : null,
	].filter((part): part is string => Boolean(part))

	return prisma.$transaction(
		async tx => {
			await lockKey(tx, `warmup-import:${row.email}`)

			// Two runs of the same click (two admins, two tabs) both read their "not imported yet" snapshot before either transaction started. Since warm-up rows are no longer held unique by `(userId, theme)`, the insert below would happily make a second project for one Airtable row; this re-read under the lock is what keeps a row to one project.
			const raced = await tx.auditLog.findFirst({
				select: { targetId: true },
				where: { action: IMPORT_ACTION, metadata: { equals: record.id, path: ["airtableRecordId"] } },
			})
			if (raced?.targetId)
				return {
					reason: "another import run filed this row first",
					status: "skipped" as const,
					themeProjectId: raced.targetId,
					userId: null,
				}

			let user = await tx.user.findFirst({
				select: { id: true },
				where: { email: { equals: row.email, mode: "insensitive" } },
			})
			let createdUser = false
			if (!user) {
				const slackTaken = row.slackId
					? await tx.user.findFirst({ select: { id: true }, where: { slackId: row.slackId } })
					: null
				const hackatimeTaken = row.hackatimeId
					? await tx.user.findFirst({ select: { id: true }, where: { hackatimeUserId: row.hackatimeId } })
					: null
				user = await tx.user.create({
					data: {
						email: row.email,
						emailVerified: false,
						joinedProgramAt: createdAt,
						name: row.name,
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
					createdAt,
					description: row.description,
					// The form's "Code URL" is free text, and the playable-url fallback is not a repo at all, so the value is run through the repo field's own rule: a bare `github.com/me/thing` gains its scheme, and anything that will not parse becomes null rather than a link nothing can open.
					githubRepo: normalizeRepo(row.repoUrl ?? "").url,
					namedAt: createdAt,
					requestedTier: tierForRequestedFunding(row.requestedFunding),
					theme: Theme.WARMUP,
					title: row.title,
					userId: user.id,
					...(phase === Phase.DESIGN ? { designStatus: PhaseStatus.in_review } : {}),
					...(phase === Phase.BUILD ? { buildStatus: PhaseStatus.in_review } : {}),
				},
				select: { id: true },
			})

			if (journalParts.length > 0 || row.hours !== null)
				await tx.workSession.create({
					data: {
						content: journalParts.length > 0 ? journalParts.join("\n\n") : null,
						createdAt,
						effectiveDate: effectiveDateFor(createdAt, programTimezone),
						hoursClaimed: row.hours ?? 0,
						hoursSource: HoursSource.MANUAL,
						phase,
						themeProjectId: project.id,
						title: `${row.title} – warm-up submission`,
						weekNumber: 0,
					},
				})

			await tx.phaseSubmission.create({
				data: {
					createdAt,
					onTime: false,
					phase,
					scheduledWeek: 0,
					submittedInWeek: 0,
					themeProjectId: project.id,
				},
			})

			// The row already exists in the table – it is where this import came from – so record its record id the same way a successful write does. That is what keeps the retry job from posting a second copy, lets a resubmission update this row instead of creating one, and lets an unsubmit remove it (see lib/airtable/sync). Nothing was written to Airtable here; `imported` says where the id came from.
			await logAuditTx(tx, {
				action: AuditAction.AIRTABLE_SYNC_SUCCESS,
				actorEmail: actor.email,
				actorId: actor.id,
				metadata: { imported: true, phase, recordId: record.id, sourceTable: YSWS_SUBMISSION.tableId },
				targetId: project.id,
				targetType: "ThemeProject",
			})

			await logAuditTx(tx, {
				action: IMPORT_ACTION,
				actorEmail: actor.email,
				actorId: actor.id,
				metadata: {
					airtableRecordId: record.id,
					createdUser,
					email: row.email,
					phase,
					sourceTable: YSWS_SUBMISSION.tableId,
				},
				targetId: project.id,
				targetType: "ThemeProject",
			})

			return {
				reason: createdUser ? "created the maker's account" : null,
				status: "imported" as const,
				themeProjectId: project.id,
				userId: user.id,
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
			actorEmail: actor.email,
			actorId: actor.id,
			metadata: { phase, warmupImport: true },
			targetId: themeProjectId,
			targetType: "ThemeProject",
		},
		() => sendSubmissionToAri(themeProjectId, phase),
	)
	return result ? "sent" : "failed"
}

/**
 * Import every warm-up row that has not been imported yet.
 *
 * Sequential on purpose: each row can download a screenshot and call Ari, and the Airtable client already rate-limits at the base's 5 req/s. `getProgramSettings` runs up front because the singleton row may need creating, which a transaction must not do while it holds a lock.
 */
async function importWarmupProjects(actor: ImportActor): Promise<WarmupImportSummary> {
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
			ari: "not_attempted",
			email: null,
			reason: null,
			recordId: record.id,
			status: "failed",
			themeProjectId: null,
			userId: null,
		}

		if (imported.has(record.id)) {
			outcomes.push({ ...base, status: "already_imported", themeProjectId: imported.get(record.id) ?? null })
			continue
		}
		if (written.has(record.id)) {
			outcomes.push({ ...base, reason: "Half Life already writes this Airtable row", status: "skipped" })
			continue
		}

		const parsed = parseRow(record)
		if (!parsed.ok) {
			outcomes.push({ ...base, reason: parsed.reason, status: "skipped" })
			continue
		}

		try {
			const result = await importRow(record, parsed.row, actor, settings.programTimezone)
			const outcome: WarmupImportOutcome = {
				...base,
				email: parsed.row.email,
				reason: result.reason,
				status: result.status,
				themeProjectId: result.themeProjectId,
				userId: result.userId,
			}

			if (result.status === "imported") {
				if (parsed.row.screenshotUrl) {
					const key = await rehostScreenshot(result.userId, parsed.row.screenshotUrl)
					if (key)
						await prisma.themeProject.update({ data: { coverImageKey: key }, where: { id: result.themeProjectId } })
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

	const count = (status: WarmupImportOutcome["status"]) => outcomes.filter(o => o.status === status).length
	return {
		alreadyImported: count("already_imported"),
		ariSent: outcomes.filter(o => o.ari === "sent").length,
		failed: count("failed"),
		fetched: records.length,
		imported: count("imported"),
		outcomes,
		skipped: count("skipped"),
		table: YSWS_SUBMISSION.tableId,
	}
}

export { importWarmupProjects, rehostScreenshot, type WarmupImportOutcome, type WarmupImportSummary }
