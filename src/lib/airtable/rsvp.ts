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
import prisma from "@/lib/prisma"

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
 * Airtable is the funnel's source of truth but it rate-limits and it goes down. Every RSVP lands in Postgres first and is drained by a job, so a marketing-page signup never fails because a third party is having a bad day. Stasis calls Airtable synchronously here and only falls back to Postgres when someone flips an env var by hand.
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
		// Re-RSVPing must not clobber attribution captured the first time, and it resets the failure count: a row that hit the drain's attempt cap while Airtable was down must be retried when the person comes back, not left permanently invisible.
		update: {
			firstName: input.firstName ?? undefined,
			lastName: input.lastName ?? undefined,
			pronouns: input.pronouns ?? undefined,
			syncedToAirtable: false,
			syncAttempts: 0,
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
		update: { userId, finishedAccountCreation: true, syncedToAirtable: false, syncAttempts: 0 },
	})
}

export interface DrainResult {
	attempted: number
	created: number
	updated: number
	failed: number
	/** Drained rows carrying a user id the base has no column for. */
	skippedUserId: number
	skipped?: string
}

/**
 * Push buffered RSVPs upstream. Idempotent and safe to run on a schedule: anything that fails stays unsynced with an incremented attempt count, and the index on (syncedToAirtable, syncAttempts, createdAt) makes finding them a single scan.
 *
 * The user id is the one field asked about rather than assumed. Airtable refuses a request whose `fields` names a column the table does not have, and it refuses the WHOLE record – so on a base without that column, sending it did not leave the id blank, it stopped the email, the name, the referral number and the rest of that row from landing, and after the attempt cap the row was abandoned for good. Probing once and omitting the field means the rest of the payload is written on a base that has not been set up yet, and the id starts filling itself the moment somebody adds the column.
 */
export async function drainRsvpBuffer(limit = 50, opts: { dryRun?: boolean } = {}): Promise<DrainResult> {
	const config = getAirtableConfig()
	if (!config) {
		return { attempted: 0, created: 0, updated: 0, failed: 0, skippedUserId: 0, skipped: "not_configured" }
	}

	const pending = await prisma.rsvpBuffer.findMany({
		where: { syncedToAirtable: false, syncAttempts: { lt: 10 } },
		orderBy: { createdAt: "asc" },
		take: limit,
	})

	const result: DrainResult = {
		attempted: pending.length,
		created: 0,
		updated: 0,
		failed: 0,
		skippedUserId: 0,
	}
	if (opts.dryRun) return result

	// Which of the columns this table has, asked once for the whole batch. Everything the drain would send is filtered through it: Airtable refuses a request naming a column it does not have, for the WHOLE record, so one unknown name loses every other field in the payload with it. The live Signups base has three of the ten the schema names, so without this every row of every drain was being rejected.
	const writable = await existingColumns(config, RSVP.tableId, Object.values(RSVP.fields).map(fieldKey))
	const skippedColumns = Object.entries(RSVP.fields)
		.filter(([, field]) => !writable.has(fieldKey(field)))
		.map(([key]) => key)
	if (skippedColumns.length > 0) {
		// Said once per drain, naming them, because "the RSVP drain is failing" is otherwise indistinguishable from "Airtable is down".
		console.warn(
			`[airtable] rsvp-drain: ${RSVP.tableId} has no column(s) ${skippedColumns.join(", ")}; those values are not ` +
				"sent. Everything else in the row is still written.",
		)
	}

	for (const row of pending) {
		try {
			const values = {
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
			}
			// Only the columns this table actually has, so one absent column cannot cost the row the seven that are present.
			const fields: Record<string, unknown> = {}
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
