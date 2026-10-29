import "server-only"
import {
	AirtableListSchema,
	type AirtableRecord,
	AirtableRecordSchema,
	AirtableUpsertSchema,
	airtableFetch,
	escapeAirtableValue,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { existingColumns } from "@/lib/airtable/field-probe"
import { recordDirectSignup } from "@/lib/airtable/rsvp"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "@/lib/airtable/schema"
import db from "@/lib/prisma8"
import type { NpsSubmit } from "@/lib/schemas/nps"

/** The four NPS columns, as the table names them. */
const SCORE = () => fieldKey(RSVP.fields.howLikelyRecommend)
const NPS_COLUMNS = () => [
	fieldKey(RSVP.fields.howLikelyRecommend),
	fieldKey(RSVP.fields.howDoingWell),
	fieldKey(RSVP.fields.howImprove),
	fieldKey(RSVP.fields.howHear),
]

const fieldsQs = (cols: readonly string[]) => cols.map(c => `fields%5B%5D=${encodeURIComponent(c)}`).join("&")

async function userEmail(userId: string): Promise<string | null> {
	const user = await db.orm.public.User.whereUnique({ id: userId }).select("email").first()
	return user?.email?.trim().toLowerCase() || null
}

/**
 * The caller's row in the Signups table, by the same keys the Loops sync joins on: the drained record id first (exact, no scan), then `Half-Life User ID`, then the email address. A row the drain recorded is addressed directly, so someone whose landing address differs from their account address is still found.
 */
export async function findSignupRecord(userId: string): Promise<AirtableRecord | null> {
	const config = getAirtableConfig()
	if (!config) return null
	const cols = NPS_COLUMNS()
	const qs = fieldsQs(cols)

	const buf = await db.orm.public.RsvpBuffer.where({ userId }).select("airtableRecordId").first()
	const recordId = buf?.airtableRecordId
	if (recordId)
		try {
			return await withRateLimitRetry("readNpsSignup", () =>
				airtableFetch(
					AirtableRecordSchema,
					config,
					`${encodeURIComponent(RSVP_TABLE_ID)}/${encodeURIComponent(recordId)}?${qs}`,
				),
			)
		} catch {
			// The recorded row is gone from the base; fall through to the filtered lookups.
		}

	const byUserId = await withRateLimitRetry("findNpsSignupById", () =>
		airtableFetch(
			AirtableListSchema,
			config,
			`${encodeURIComponent(RSVP_TABLE_ID)}?maxRecords=1&filterByFormula=${encodeURIComponent(`{${RSVP.fields.userId.name}}='${escapeAirtableValue(userId)}'`)}&${qs}`,
		),
	)
	if (byUserId.records[0]) return byUserId.records[0]

	const email = await userEmail(userId)
	if (!email) return null
	const byEmail = await withRateLimitRetry("findNpsSignupByEmail", () =>
		airtableFetch(
			AirtableListSchema,
			config,
			`${encodeURIComponent(RSVP_TABLE_ID)}?maxRecords=1&filterByFormula=${encodeURIComponent(`LOWER({${RSVP.fields.email.name}})='${escapeAirtableValue(email)}'`)}&${qs}`,
		),
	)
	return byEmail.records[0] ?? null
}

export type NpsStatus = { completed: boolean } | { skipped: string }

/**
 * Whether the blocking prompt has been answered. A row holding a score number – 0 counts – is done; anything else is not. Skipped rather than blocking when Airtable is unconfigured or the base predates the columns, so a half-built base never parks every user behind a form that cannot save.
 */
export async function readNpsStatus(userId: string): Promise<NpsStatus> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	const cols = NPS_COLUMNS()
	const writable = await existingColumns(config, RSVP_TABLE_ID, cols)
	if (!writable.has(SCORE())) return { skipped: "no_column" }
	const row = await findSignupRecord(userId)
	if (!row) return { completed: false }
	return { completed: typeof row.fields[SCORE()] === "number" }
}

/**
 * Save the answers onto the caller's Signups row. Updates the row in place when one is found; otherwise creates it keyed on the account email, so someone with no landing row is still unblocked by answering. Only columns the table actually has are sent, and the buffer remembers a row this creates for the record-id join.
 */
export async function writeNps(userId: string, values: NpsSubmit): Promise<{ updated: boolean } | { skipped: string }> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	const cols = NPS_COLUMNS()
	const writable = await existingColumns(config, RSVP_TABLE_ID, cols)
	const fields: { [_: string]: unknown } = {
		[fieldKey(RSVP.fields.howDoingWell)]: values.howDoingWell?.trim() ? values.howDoingWell.trim() : undefined,
		[fieldKey(RSVP.fields.howHear)]: values.howHear?.trim() ? values.howHear.trim() : undefined,
		[fieldKey(RSVP.fields.howImprove)]: values.howImprove?.trim() ? values.howImprove.trim() : undefined,
		[fieldKey(RSVP.fields.howLikelyRecommend)]: values.howLikelyRecommend,
	}
	for (const key of Object.keys(fields)) if (fields[key] === undefined || !writable.has(key)) delete fields[key]
	if (Object.keys(fields).length === 0) return { skipped: "no_column" }

	const row = await findSignupRecord(userId)
	if (row) {
		await withRateLimitRetry("updateNpsSignup", () =>
			airtableFetch(AirtableListSchema, config, encodeURIComponent(RSVP_TABLE_ID), {
				body: JSON.stringify({ records: [{ fields, id: row.id }], typecast: false }),
				method: "PATCH",
			}),
		)
		return { updated: true }
	}

	const email = await userEmail(userId)
	if (!email) return { skipped: "no_user" }
	const created = await withRateLimitRetry(
		"createNpsSignup",
		() =>
			airtableFetch(AirtableUpsertSchema, config, encodeURIComponent(RSVP_TABLE_ID), {
				body: JSON.stringify({
					performUpsert: { fieldsToMergeOn: [fieldKey(RSVP.fields.email)] },
					records: [{ fields: { ...fields, [fieldKey(RSVP.fields.email)]: email } }],
					typecast: false,
				}),
				method: "PATCH",
			}),
		{ retryServerErrors: false },
	)
	const recordId = created.records[0]?.id
	if (recordId) await recordDirectSignup({ email, recordId, userId })
	return { updated: true }
}
