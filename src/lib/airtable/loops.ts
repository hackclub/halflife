import "server-only"
import { Phase } from "@/app/generated/prisma/enums"
import {
	AirtableError,
	type AirtableRecord,
	airtableFetch,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "@/lib/airtable/schema"
import { THEMES } from "@/lib/config/program"
import prisma from "@/lib/prisma"

/**
 * The Loops properties on the `Signups` table: what Loops emails people from.
 *
 * Twelve columns, all Half Life's to write: when someone was last seen on the
 * site, when they last logged a journal entry, and one checkbox per program
 * week for whether they have completed that week's first checkpoint.
 * Everything else Half Life tracks stays in Postgres (lib/analytics) — Loops
 * needs these, not the rest.
 *
 * "Last login" is last site access, from `lastActiveAt` (the page-view
 * heartbeat, lib/analytics), falling back to `lastLoginAt` for someone who has
 * signed in but not been seen since. Loops keys its re-engagement email off
 * that, so a visit counts, not just a fresh session.
 *
 * Rows are matched on `Half-Life User ID` where the column exists, falling back
 * to a case-insensitive email match. The id is the reliable one and the email
 * is the fallback, because the two genuinely disagree: the Signups table is the
 * landing page's list, so a row's email is whatever address someone typed
 * before they had an account, while `User.email` is what the identity provider
 * later gave them. Measured on the dev base, 5100 of 5101 rows had no user
 * sharing their email — matching on email alone matched one person and left
 * every Loops column empty for the rest, which is exactly the bug this column
 * already existed to prevent (see RSVP.fields.userId).
 *
 * Only existing rows are updated: this table is the landing page's sign-up list,
 * and a row made here would put someone on a Loops list they never joined.
 * Someone whose Half Life account has no row is skipped and counted, not
 * created.
 */

const TABLE = RSVP_TABLE_ID

export const LOOPS_FIELDS = {
	// The same column the RSVP drain writes. See RSVP.fields.email: the live
	// column is lowercase, and Airtable field names are case-sensitive — naming
	// it `Email` made the list request a 422 that stopped this sync ever running.
	email: fieldKey(RSVP.fields.email),
	// The join key, when the base has it. See the note above.
	userId: fieldKey(RSVP.fields.userId),
	lastLoginAt: "Loops - halfLifeLastLoginAt",
	lastEntryAt: "Loops - halfLifeLastEntryAt",
	week: (n: number) => `Loops - halfLifeWeek${n}Project`,
} as const

const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)

/** What Loops should hold for one person. */
interface LoopsValues {
	id: string
	email: string
	/** Airtable's "last login": last site access, or the sign-in before it. */
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
			id: true,
			email: true,
			lastLoginAt: true,
			lastActiveAt: true,
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
		// "Last login" means last time we saw them, so a page view wins over the
		// sign-in that started the session; a sign-in with no view since still
		// counts, so take whichever is newer.
		const lastLoginAt = newest(u.lastLoginAt, u.lastActiveAt)
		return { id: u.id, email: u.email, lastLoginAt, lastEntryAt, weeks }
	})
}

/** The later of two nullable instants. */
function newest(a: Date | null, b: Date | null): Date | null {
	if (!a) return b
	if (!b) return a
	return a > b ? a : b
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

/**
 * Whether this base has the `Half-Life User ID` column.
 *
 * Airtable 422s a list request naming a field that does not exist, and it does
 * so for the whole request — so asking for the id column on a base without it
 * takes the entire sync down, not just the join. One single-record probe
 * settles it per instance instead.
 *
 * Cached because it is a property of the base, not of the run: a base either
 * has the column or it does not, and re-probing on every sync would spend a
 * request an hour to learn something that cannot have changed.
 */
let hasUserIdColumn: boolean | null = null

async function userIdColumnExists(config: NonNullable<ReturnType<typeof getAirtableConfig>>): Promise<boolean> {
	if (hasUserIdColumn !== null) return hasUserIdColumn
	try {
		await airtableFetch(
			config,
			`${encodeURIComponent(TABLE)}?maxRecords=1&fields%5B%5D=${encodeURIComponent(LOOPS_FIELDS.userId)}`,
		)
		hasUserIdColumn = true
	} catch (err) {
		// Only a missing field is "absent". A rate limit or an outage is a real
		// fault and must not be remembered as a fact about the base, or the id
		// join would be switched off for the life of the process by one bad minute.
		const missing = err instanceof AirtableError && err.status === 422 && err.body.includes("UNKNOWN_FIELD_NAME")
		if (!missing) throw err
		hasUserIdColumn = false
		console.warn(
			`[airtable] no \`${LOOPS_FIELDS.userId}\` column in ${TABLE}; falling back to matching Loops rows by email`,
		)
	}
	return hasUserIdColumn
}

/**
 * Which Signups row, if any, is this person's.
 *
 * Split out from the sync and free of I/O so the join can be tested directly —
 * this is the one decision that made every Loops column silently empty, and it
 * fails quietly by design: a row that is not found is skipped and counted, not
 * an error, so a wrong join looks exactly like a healthy run that had nothing
 * to do.
 *
 * The id wins. It is the only key that survives somebody typing one address on
 * the landing page and being issued a different one at sign-in, which is the
 * normal case rather than an edge one. Email stays as the fallback for rows the
 * RSVP drain has not stamped yet.
 */
export function resolveSignupRow(
	value: Pick<LoopsValues, "id" | "email">,
	rows: { byEmail: Map<string, AirtableRecord>; byUserId: Map<string, AirtableRecord> },
): { row: AirtableRecord; by: "id" | "email" } | null {
	const byId = rows.byUserId.get(value.id)
	if (byId) return { row: byId, by: "id" }
	const byEmail = rows.byEmail.get(value.email.trim().toLowerCase())
	return byEmail ? { row: byEmail, by: "email" } : null
}

/** Every row of the table, indexed both ways. */
async function signupRows(config: NonNullable<ReturnType<typeof getAirtableConfig>>) {
	const byEmail = new Map<string, AirtableRecord>()
	const byUserId = new Map<string, AirtableRecord>()
	const withUserId = await userIdColumnExists(config)
	const want = [
		LOOPS_FIELDS.email,
		...(withUserId ? [LOOPS_FIELDS.userId] : []),
		LOOPS_FIELDS.lastLoginAt,
		LOOPS_FIELDS.lastEntryAt,
		...WEEKS.map(LOOPS_FIELDS.week),
	]
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
			const userId = r.fields[LOOPS_FIELDS.userId]
			if (typeof userId === "string" && !byUserId.has(userId.trim())) {
				byUserId.set(userId.trim(), r)
			}
		}
		offset = page.offset
	} while (offset)
	return { byEmail, byUserId }
}

export interface LoopsSyncResult {
	users: number
	matched: number
	/** Rows found by `Half-Life User ID`. */
	matchedById: number
	/** Rows found only by email, because the row had no user id on it. */
	matchedByEmail: number
	/** Half Life users with no row in Signups. */
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
	let matchedById = 0
	let matchedByEmail = 0
	let same = 0
	for (const v of values) {
		const hit = resolveSignupRow(v, rows)
		if (!hit) continue
		matched++
		if (hit.by === "id") matchedById++
		else matchedByEmail++
		const fields = fieldsFor(v)
		if (unchanged(hit.row, fields)) same++
		else updates.push({ id: hit.row.id, email: v.email, fields })
	}

	const result: LoopsSyncResult = {
		users: values.length,
		matched,
		matchedById,
		matchedByEmail,
		unmatched: values.length - matched,
		updated: updates.length,
		unchanged: same,
		dryRun: !!opts.dryRun,
	}

	// A join that stops matching does not throw: rows are skipped and counted, so
	// the run reports success while writing nothing, and the only symptom is that
	// the columns stay empty. That is precisely how this went unnoticed, so a
	// collapse in the match rate is called out loudly rather than returned as a
	// number somebody has to notice. Most often it means the base has no
	// `Half-Life User ID` column, or the RSVP drain has not been running to fill
	// it — either way the fix is on the Airtable side, not here.
	if (values.length >= 50 && matched * 2 < values.length) {
		console.error(
			`[airtable] Loops sync matched only ${matched}/${values.length} Half Life users to a Signups row ` +
				`(${matchedById} by id, ${matchedByEmail} by email) — ${result.unmatched} were skipped and their Loops ` +
				`columns left empty. Check that ${TABLE} has a \`${LOOPS_FIELDS.userId}\` column and that the RSVP drain is running.`,
		)
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
