import "server-only"
import {
	type AirtableRecord,
	airtableFetch,
	escapeAirtableValue,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { existingColumns } from "@/lib/airtable/field-probe"
import { fieldKey, formulaRef, RSVP } from "@/lib/airtable/schema"
import db, { isUniqueViolation } from "@/lib/prisma8"
import { formatDbTimestamp } from "@/lib/time"

export interface RsvpInput {
	email: string
	firstName?: string | null
	ip?: string | null
	lastName?: string | null
	pronouns?: string | null
	referredBy?: string | null
	signupPage?: string | null
	utmSource?: string | null
}

/**
 * Write-behind, not write-through.
 *
 * Airtable is the funnel's source of truth but it rate-limits and it goes down. Every RSVP lands in Postgres first and is drained by a job, so a marketing-page signup never fails because a third party is having a bad day. Stasis calls Airtable synchronously here and only falls back to Postgres when someone flips an env var by hand.
 */
export async function bufferRsvp(input: RsvpInput): Promise<{ buffered: true }> {
	const email = input.email.trim().toLowerCase()
	// Create-or-update on the email key: upsert's conflictOn only takes the primary key, so a duplicate insert is the existence proof and the update follows it.
	try {
		await db.orm.public.RsvpBuffer.create({
			email,
			firstName: input.firstName ?? null,
			ip: input.ip ?? null,
			lastName: input.lastName ?? null,
			pronouns: input.pronouns ?? null,
			referredBy: input.referredBy ?? null,
			signupPage: input.signupPage ?? null,
			utmSource: input.utmSource ?? null,
		})
	} catch (err) {
		if (!isUniqueViolation(err)) throw err
		// Re-RSVPing must not clobber attribution captured the first time, and it resets the failure count: a row that hit the drain's attempt cap while Airtable was down must be retried when the person comes back, not left permanently invisible.
		await db.orm.public.RsvpBuffer.where({ email }).update({
			...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
			...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
			...(input.pronouns !== undefined ? { pronouns: input.pronouns } : {}),
			syncAttempts: 0,
			syncedToAirtable: false,
		})
	}
	return { buffered: true }
}

/** Called from the signup hook once a real account exists. */
export async function bufferRsvpForUser(userId: string, email: string, name: string | null): Promise<void> {
	const [firstName, ...rest] = (name ?? "").trim().split(/\s+/)
	try {
		await db.orm.public.RsvpBuffer.create({
			email: email.trim().toLowerCase(),
			finishedAccountCreation: true,
			firstName: firstName || null,
			lastName: rest.length > 0 ? rest.join(" ") : null,
			userId,
		})
	} catch (err) {
		if (!isUniqueViolation(err)) throw err
		await db.orm.public.RsvpBuffer.where({ email: email.trim().toLowerCase() }).update({
			finishedAccountCreation: true,
			syncAttempts: 0,
			syncedToAirtable: false,
			userId,
		})
	}
}

/**
 * Remember a row the landing form wrote straight to Airtable.
 *
 * `recordSignup` (lib/site/signups) POSTs to the Signups table directly when credentials are set, bypassing the drain – so without this, that row has no `RsvpBuffer` entry, no `airtableRecordId` mapping, and the Loops sync's record-id join can never find it. The one row in the live base with Loops dates is the exception that proves it: it came through the signed-in referral path, not the landing.
 *
 * Safe to call from the request path: never throws, never touches the Airtable row, and never flips a pending user-id stamp back to synced. When the address already has a buffer row (e.g. account creation already linked a user id whose drain stamp is still pending), only the missing record id is filled in.
 */
export async function recordDirectSignup(input: {
	email: string
	recordId: string
	ip?: string | null
	utmSource?: string | null
	referredBy?: string | null
	userId?: string | null
}): Promise<void> {
	try {
		const email = input.email.trim().toLowerCase()
		if (!email || !input.recordId) return
		const existing = await db.orm.public.RsvpBuffer.where({ email }).first()
		if (!existing) {
			await db.orm.public.RsvpBuffer.create({
				airtableRecordId: input.recordId,
				email,
				finishedAccountCreation: Boolean(input.userId),
				ip: input.ip ?? null,
				referredBy: input.referredBy ?? null,
				syncedAt: input.userId ? null : formatDbTimestamp(new Date()),
				// A row carrying a user id still needs the drain to PATCH it upstream; anything else is already upstream.
				syncedToAirtable: !input.userId,
				userId: input.userId ?? null,
				utmSource: input.utmSource ?? null,
			})
			return
		}
		const data: {
			airtableRecordId?: string
			finishedAccountCreation?: boolean
			syncAttempts?: number
			syncedToAirtable?: boolean
			userId?: string
		} = {}
		if (!existing.airtableRecordId) data.airtableRecordId = input.recordId
		if (input.userId && !existing.userId) {
			data.userId = input.userId
			data.finishedAccountCreation = true
			data.syncedToAirtable = false
			data.syncAttempts = 0
		}
		if (Object.keys(data).length > 0) await db.orm.public.RsvpBuffer.where({ email }).update(data)
	} catch (err) {
		console.error("[airtable] recordDirectSignup failed:", err)
	}
}

export interface DrainResult {
	attempted: number
	created: number
	failed: number
	skipped?: string
	/** Drained rows carrying a user id the base has no column for. */
	skippedUserId: number
	updated: number
}

/**
 * Push buffered RSVPs upstream. Idempotent and safe to run on a schedule: anything that fails stays unsynced with an incremented attempt count, and the partial index on createdAt over the unsynced rows finds them in the order they are drained.
 *
 * The user id is the one field asked about rather than assumed. Airtable refuses a request whose `fields` names a column the table does not have, and it refuses the WHOLE record – so on a base without that column, sending it did not leave the id blank, it stopped the email, the name, the referral number and the rest of that row from landing, and after the attempt cap the row was abandoned for good. Probing once and omitting the field means the rest of the payload is written on a base that has not been set up yet, and the id starts filling itself the moment somebody adds the column.
 */
export async function drainRsvpBuffer(limit = 50, opts: { dryRun?: boolean } = {}): Promise<DrainResult> {
	const config = getAirtableConfig()
	if (!config) return { attempted: 0, created: 0, failed: 0, skipped: "not_configured", skippedUserId: 0, updated: 0 }

	const pending = await db.orm.public.RsvpBuffer.where(row => row.syncAttempts.lt(10))
		.where({ syncedToAirtable: false })
		.orderBy(row => row.createdAt.asc())
		.limit(limit)
		.all()

	const result: DrainResult = {
		attempted: pending.length,
		created: 0,
		failed: 0,
		skippedUserId: 0,
		updated: 0,
	}
	if (opts.dryRun) return result

	// Which of the columns this table has, asked once for the whole batch. Everything the drain would send is filtered through it: Airtable refuses a request naming a column it does not have, for the WHOLE record, so one unknown name loses every other field in the payload with it. The live Signups base has three of the ten the schema names, so without this every row of every drain was being rejected.
	const writable = await existingColumns(config, RSVP.tableId, Object.values(RSVP.fields).map(fieldKey))
	const skippedColumns = Object.entries(RSVP.fields)
		.filter(([, field]) => !writable.has(fieldKey(field)))
		.map(([key]) => key)
	if (skippedColumns.length > 0)
		// Said once per drain, naming them, because "the RSVP drain is failing" is otherwise indistinguishable from "Airtable is down".
		console.warn(
			`[airtable] rsvp-drain: ${RSVP.tableId} has no column(s) ${skippedColumns.join(", ")}; those values are not `
				+ "sent. Everything else in the row is still written.",
		)

	for (const row of pending)
		try {
			// `RsvpBuffer.signupPage` is deliberately absent: the base has no column for it (see RSVP.fields), so a row still carrying one writes everything else and drops that. The field is left on the buffer because /api/rsvp accepts it from outside this repo; the day a column exists, it belongs back in this list.
			const values = {
				email: row.email,
				finishedAccountCreation: row.finishedAccountCreation,
				firstName: row.firstName ?? undefined,
				ip: row.ip ?? undefined,
				lastName: row.lastName ?? undefined,
				pronouns: row.pronouns ?? undefined,
				referredBy: row.referredBy ?? undefined,
				userId: row.userId ?? undefined,
				utmSource: row.utmSource ?? undefined,
			}
			// Only the columns this table actually has, so one absent column cannot cost the row the seven that are present.
			const fields: { [_: string]: unknown } = {}
			for (const [key, value] of Object.entries(values)) {
				if (value === undefined) continue
				const field = RSVP.fields[key as keyof typeof RSVP.fields]
				if (field && writable.has(fieldKey(field))) fields[fieldKey(field)] = value
			}
			if (row.userId && !writable.has(fieldKey(RSVP.fields.userId))) result.skippedUserId++

			let recordId = row.airtableRecordId
			if (recordId) {
				// Once the row exists upstream, updates are a patch by id rather than a formula search.
				await withRateLimitRetry("updateRsvp", () =>
					airtableFetch(config, `${RSVP.tableId}/${recordId}`, {
						body: JSON.stringify({ fields }),
						method: "PATCH",
					}),
				)
				result.updated++
			} else {
				const upserted = await withRateLimitRetry("upsertRsvp", () =>
					airtableFetch<{ records: AirtableRecord[]; updatedRecords?: string[] }>(config, RSVP.tableId, {
						body: JSON.stringify({
							performUpsert: { fieldsToMergeOn: [fieldKey(RSVP.fields.email)] },
							records: [{ fields }],
							typecast: false,
						}),
						method: "PATCH",
					}),
				)
				recordId = upserted.records[0]?.id ?? null
				if (upserted.updatedRecords?.length) result.updated++
				else result.created++
			}

			await db.orm.public.RsvpBuffer.where({ id: row.id }).update({
				airtableRecordId: recordId,
				lastSyncError: null,
				syncedAt: formatDbTimestamp(new Date()),
				syncedToAirtable: true,
			})
		} catch (err) {
			result.failed++
			// Prisma 8 has no increment: one raw statement rather than read-modify-write, so concurrent drains cannot lose an attempt.
			const bump = db.raw
				.sql`UPDATE "rsvp_buffer" SET "syncAttempts" = "syncAttempts" + 1, "lastSyncError" = ${err instanceof Error ? err.message : String(err)} WHERE "id" = ${row.id}`
				.affectedCount()
				.build()
			await db.execute(bump)
		}

	return result
}

/** Total RSVPs, for the landing page counter. */
export async function getRsvpCount(): Promise<number> {
	const { count } = await db.orm.public.RsvpBuffer.aggregate(a => ({ count: a.count() }))
	return count
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
