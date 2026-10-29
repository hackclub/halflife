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
import type { NpsTextsSubmit } from "@/lib/schemas/nps"

/** The score column, as the table names it. */
const SCORE = () => fieldKey(RSVP.fields.howLikelyRecommend)

/** The three text columns, as the table names them. */
const TEXT_COLUMNS = () => [
	fieldKey(RSVP.fields.howDoingWell),
	fieldKey(RSVP.fields.howImprove),
	fieldKey(RSVP.fields.howHear),
]

/** The four NPS columns, as the table names them. */
const NPS_COLUMNS = () => [SCORE(), ...TEXT_COLUMNS()]

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

export type NpsState = { score: number | null; textsDone: boolean } | { skipped: string }

/** Whether the answered text is anything at all: whitespace alone is not feedback. */
const hasText = (value: unknown): boolean => typeof value === "string" && value.trim().length > 0

/**
 * Where the caller stands in the two-step flow. The score gates the dashboard; the texts only decide the corner nudge. A row holding a score number – 0 counts – has answered the first step, and a row holding any text has answered the second. Skipped rather than blocking when Airtable is unconfigured or the base predates the columns, so a half-built base never parks anyone behind a form that cannot save – and a base without the text columns reads the second step as done, so nobody is nudged for answers that cannot be stored.
 */
export async function readNpsState(userId: string): Promise<NpsState> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	const writable = await existingColumns(config, RSVP_TABLE_ID, NPS_COLUMNS())
	if (!writable.has(SCORE())) return { skipped: "no_column" }
	const textsWritable = TEXT_COLUMNS().some(c => writable.has(c))
	const row = await findSignupRecord(userId)
	if (!row) return { score: null, textsDone: !textsWritable }
	const score = row.fields[SCORE()]
	return {
		score: typeof score === "number" ? score : null,
		textsDone: !textsWritable || TEXT_COLUMNS().some(c => hasText(row.fields[c])),
	}
}

/**
 * PATCH the caller's Signups row, creating it keyed on the account email when they have no landing row, so someone without one is still unblocked by answering. Only columns the table actually has are sent, and the buffer remembers a row this creates for the record-id join.
 */
async function patchSignupRow(
	userId: string,
	fields: { [_: string]: unknown },
	operation: string,
): Promise<{ updated: boolean } | { skipped: string }> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	if (Object.keys(fields).length === 0) return { skipped: "no_column" }

	const row = await findSignupRecord(userId)
	if (row) {
		await withRateLimitRetry(operation, () =>
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
		`${operation}Create`,
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

/** Save the score – the blocking first step. */
export async function writeNpsScore(
	userId: string,
	score: number,
): Promise<{ updated: boolean } | { skipped: string }> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	const writable = await existingColumns(config, RSVP_TABLE_ID, [SCORE()])
	if (!writable.has(SCORE())) return { skipped: "no_column" }
	return patchSignupRow(userId, { [SCORE()]: score }, "updateNpsScore")
}

/**
 * Save the follow-up texts – the unblocking second step. Blank answers are dropped before the write, so an all-empty submit is a successful no-op: the device that sent it counts the step as answered, and a row that gains any text stops the nudge everywhere.
 */
export async function writeNpsTexts(
	userId: string,
	values: NpsTextsSubmit,
): Promise<{ updated: boolean } | { skipped: string }> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	const writable = await existingColumns(config, RSVP_TABLE_ID, TEXT_COLUMNS())
	const fields: { [_: string]: unknown } = {
		[fieldKey(RSVP.fields.howDoingWell)]: values.howDoingWell?.trim() ? values.howDoingWell.trim() : undefined,
		[fieldKey(RSVP.fields.howHear)]: values.howHear?.trim() ? values.howHear.trim() : undefined,
		[fieldKey(RSVP.fields.howImprove)]: values.howImprove?.trim() ? values.howImprove.trim() : undefined,
	}
	for (const key of Object.keys(fields)) if (fields[key] === undefined || !writable.has(key)) delete fields[key]
	if (Object.keys(fields).length === 0) return { updated: true }
	return patchSignupRow(userId, fields, "updateNpsTexts")
}
