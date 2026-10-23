import "server-only"
import { HoursSource, Phase } from "@/app/generated/prisma/enums"
import {
	type AirtableRecord,
	airtableFetch,
	escapeAirtableValue,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { columnExists, existingColumns } from "@/lib/airtable/field-probe"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "@/lib/airtable/schema"
import { scheduledWeekFor, THEMES } from "@/lib/config/program"
import prisma from "@/lib/prisma"

/**
 * The Loops properties on the `Signups` table: what Loops emails people from.
 *
 * Twenty-two columns, all Half Life's to write: when someone was last seen on the site, when they last logged a journal entry, one checkbox per program week for whether they have completed that week's first checkpoint, and one checkbox per program week for whether they have submitted that week's project. Everything else Half Life tracks stays in Postgres (lib/analytics) – Loops needs these, not the rest.
 *
 * "Last login" is last site access, from `lastActiveAt` (the page-view heartbeat, lib/analytics), falling back to `lastLoginAt` for someone who has signed in but not been seen since. Loops keys its re-engagement email off that, so a visit counts, not just a fresh session.
 *
 * "Last entry" is the newest real journal entry: a session the maker wrote themselves, or one carrying a timelapse. Hackatime-tracked rows and a bare Hackatime link are not entries, so a user with only Hackatime evidence gets nothing – and any timestamp an older sync stamped is removed on the next run.
 *
 * Rows are matched on `Half-Life User ID` where the column exists, falling back to a case-insensitive email match. The id is the reliable one and the email is the fallback, because the two genuinely disagree: the Signups table is the landing page's list, so a row's email is whatever address someone typed before they had an account, while `User.email` is what the identity provider later gave them. Measured on the dev base, 5100 of 5101 rows had no user sharing their email – matching on email alone matched one person and left every Loops column empty for the rest, which is exactly the bug this column already existed to prevent (see RSVP.fields.userId).
 *
 * Only existing rows are updated: this table is the landing page's sign-up list, and a row made here would put someone on a Loops list they never joined. Someone whose Half Life account has no row is skipped and counted, not created.
 */

const TABLE = RSVP_TABLE_ID

export const LOOPS_FIELDS = {
	// The same column the RSVP drain writes. See RSVP.fields.email: the live column is lowercase, and Airtable field names are case-sensitive – naming it `Email` made the list request a 422 that stopped this sync ever running.
	email: fieldKey(RSVP.fields.email),
	lastEntryAt: "Loops - halfLifeLastEntryAt",
	lastLoginAt: "Loops - halfLifeLastLoginAt",
	// Ticked when the week's project has been submitted (any PhaseSubmission filed for that scheduled week). Written immediately on submit (see syncLoopsWeekSubmitted) and healed hourly by this sync, so Loops can trigger off a hand-in without waiting for the next run.
	submitted: (n: number) => `Loops - halfLifeWeek${n}ProjectSubmitted`,
	// The join key, when the base has it. See the note above.
	userId: fieldKey(RSVP.fields.userId),
	week: (n: number) => `Loops - halfLifeWeek${n}Project`,
} as const

const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)

/** What Loops should hold for one person. */
interface LoopsValues {
	email: string
	id: string
	lastEntryAt: Date | null
	/** Airtable's "last login": last site access, or the sign-in before it. */
	lastLoginAt: Date | null
	/** Week number → completed that week's first checkpoint. */
	weeks: { [_: number]: boolean }
	/** Week number → submitted that week's project. */
	weeksSubmitted: { [_: number]: boolean }
}

/**
 * Each person's values, from Postgres.
 *
 * A week's box is ticked when its first checkpoint is complete, which differs by kind of week:
 * - week 1's is "Get started", the onboarding;
 * - weeks 2-5 open with "New project", complete once the project has its description and tier (`namedAt`, see lib/analytics);
 * - weeks 6-10 are the builds of those same projects and open straight into logging, so their first checkpoint is the first build journal entry.
 */
async function loopsValues(): Promise<LoopsValues[]> {
	const users = await prisma.user.findMany({
		select: {
			email: true,
			id: true,
			lastActiveAt: true,
			lastLoginAt: true,
			onboardingCompletedAt: true,
			themeProjects: {
				select: {
					namedAt: true,
					submissions: { select: { phase: true, scheduledWeek: true } },
					theme: true,
					workSessions: {
						orderBy: { createdAt: "desc" },
						select: { createdAt: true, hoursSource: true, phase: true, timelapses: { select: { id: true }, take: 1 } },
						where: { deletedAt: null },
					},
				},
				where: { deletedAt: null },
			},
		},
	})

	return users.map(u => {
		const weeks: { [_: number]: boolean } = {}
		for (const def of THEMES) {
			const project = u.themeProjects.find(p => p.theme === def.id)
			weeks[def.designWeek] = def.designWeek === 1 ? u.onboardingCompletedAt !== null : project?.namedAt != null
			weeks[def.buildWeek] = project?.workSessions.some(s => s.phase === Phase.BUILD) ?? false
		}
		// Submitted means a hand-in exists for that scheduled week, in any state – in review, approved, or sent back. Rows from before `scheduledWeek` was recorded fall back to the theme and phase's own week, and the warm-up's week 0 is not a program week. Unsubmitting deletes the open row, so a week taken back with no other hand-in reads as unsubmitted again.
		const submittedWeeks = new Set<number>()
		for (const p of u.themeProjects)
			for (const s of p.submissions) {
				const w = s.scheduledWeek ?? scheduledWeekFor(p.theme, s.phase)
				if (w >= 1 && w <= 10) submittedWeeks.add(w)
			}

		const weeksSubmitted: { [_: number]: boolean } = {}
		for (const n of WEEKS) weeksSubmitted[n] = submittedWeeks.has(n)
		// Last entry means evidence of an actual entry: a manually written session, or a session carrying a timelapse. A HACKATIME_TRACKED row only says a Hackatime project was linked and contributes nothing on its own – someone who has only linked Hackatime gets no timestamp, and a previously stamped one is cleared below.
		const lastEntryAt = u.themeProjects
			.flatMap(p => p.workSessions)
			.filter(s => s.hoursSource !== HoursSource.HACKATIME_TRACKED || s.timelapses.length > 0)
			.map(s => s.createdAt)
			.reduce<Date | null>((a, b) => (a && a > b ? a : b), null)
		// "Last login" means last time we saw them, so a page view wins over the sign-in that started the session; a sign-in with no view since still counts, so take whichever is newer.
		const lastLoginAt = newest(u.lastLoginAt, u.lastActiveAt)
		return { email: u.email, id: u.id, lastEntryAt, lastLoginAt, weeks, weeksSubmitted }
	})
}

/** The later of two nullable instants. */
function newest(a: Date | null, b: Date | null): Date | null {
	if (!a) return b
	if (!b) return a
	return a > b ? a : b
}

/** The Airtable fields for one person, exactly as the table names them. */
function fieldsFor(v: LoopsValues): { [_: string]: unknown } {
	const fields: { [_: string]: unknown } = {
		// null clears a date that no longer applies.
		[LOOPS_FIELDS.lastLoginAt]: v.lastLoginAt?.toISOString() ?? null,
		[LOOPS_FIELDS.lastEntryAt]: v.lastEntryAt?.toISOString() ?? null,
	}
	for (const n of WEEKS) fields[LOOPS_FIELDS.week(n)] = v.weeks[n] ?? false
	for (const n of WEEKS) fields[LOOPS_FIELDS.submitted(n)] = v.weeksSubmitted[n] ?? false
	return fields
}

/** Whether a row already holds these values, so an unchanged row is not rewritten. */
function unchanged(row: AirtableRecord, fields: { [_: string]: unknown }): boolean {
	return Object.entries(fields).every(([k, want]) => {
		const have = row.fields[k]
		if (typeof want === "boolean") return (have === true) === want
		if (want === null) return have === undefined || have === null || have === ""
		// Airtable returns dates as ISO strings; compare the instants.
		return typeof have === "string" && new Date(have).getTime() === new Date(want as string).getTime()
	})
}

/**
 * Which Signups row, if any, is this person's.
 *
 * Split out from the sync and free of I/O so the join can be tested directly – this is the one decision that made every Loops column silently empty, and it fails quietly by design: a row that is not found is skipped and counted, not an error, so a wrong join looks exactly like a healthy run that had nothing to do.
 *
 * Three keys, strongest first:
 *
 * 1. **The `Half-Life User ID` column.** The designed join, and the one that survives somebody typing one address on the landing page and being issued a different one at sign-in.
 * 2. **The Airtable record id the RSVP drain recorded.** Not a fuzzy match at all: it is the row this app itself created for this person, read back out of `RsvpBuffer`. It is here because key 1 is only stamped by the drain, and rows the landing form wrote straight to Airtable never went through the drain – going forward `recordDirectSignup` remembers those rows, but rows from before that fix are only reachable this way if a buffer entry already names them.
 * 3. **Email.** The last resort, and the one that mostly fails: the Signups row holds whatever address was typed on the landing page.
 */
export function resolveSignupRow(
	value: Pick<LoopsValues, "id" | "email">,
	rows: {
		byEmail: Map<string, AirtableRecord>
		byUserId: Map<string, AirtableRecord>
		byRecordId?: Map<string, AirtableRecord>
	},
): { row: AirtableRecord; by: "id" | "record" | "email" } | null {
	const byId = rows.byUserId.get(value.id)
	if (byId) return { by: "id", row: byId }
	const byRecord = rows.byRecordId?.get(value.id)
	if (byRecord) return { by: "record", row: byRecord }
	const byEmail = rows.byEmail.get(value.email.trim().toLowerCase())
	return byEmail ? { by: "email", row: byEmail } : null
}

/**
 * The rows this app itself created, indexed by Half Life user id.
 *
 * `RsvpBuffer.airtableRecordId` is the Airtable record for a signup this app drained, and `RsvpBuffer.userId` is whose it is. Together they are an exact mapping that costs one indexed read and needs no column added to the base.
 */
async function drainedRecordRows(): Promise<Map<string, AirtableRecord>> {
	const byRecordId = new Map<string, AirtableRecord>()
	const rows = await prisma.rsvpBuffer.findMany({
		select: { airtableRecordId: true, userId: true },
		where: { airtableRecordId: { not: null }, userId: { not: null } },
	})
	// The row id in the listing and the one the drain recorded are the same thing, so this needs no second request: a placeholder is enough for the join, and the write below addresses the real record by that id.
	for (const row of rows)
		if (row.userId && row.airtableRecordId && !byRecordId.has(row.userId))
			byRecordId.set(row.userId, { fields: {}, id: row.airtableRecordId })

	return byRecordId
}

/**
 * Remember the row for every user whose email still matches one.
 *
 * The landing form wrote straight to Airtable without leaving an
 * `RsvpBuffer` entry (now fixed at the source by `recordDirectSignup`), so
 * for rows from before that fix the email match is the only key that reaches
 * them – and it stops working the moment the address changes. Persisting the
 * (user id, record id) pair upgrades those users to the record-id join and
 * queues the drain to stamp `Half-Life User ID` onto their row, so the match
 * survives an email change. Only fills in what is missing and never moves a
 * row onto a different user: a buffer row already pointing at someone else is
 * left alone.
 *
 * Runs inside the sync rather than only in the one-shot backfill script so
 * the hourly job heals itself – the way this stayed broken for months was a
 * job that needed a manual step nobody ran. Steady-state cost is zero: users
 * already in `known` short-circuit before any query.
 */
async function persistRecordLinks(
	values: Pick<LoopsValues, "id" | "email">[],
	byEmail: Map<string, AirtableRecord>,
	known: Map<string, AirtableRecord>,
): Promise<number> {
	let linked = 0
	for (const v of values) {
		if (known.has(v.id)) continue
		const row = byEmail.get(v.email.trim().toLowerCase())
		if (!row) continue
		const key = v.email.trim().toLowerCase()
		const existing = await prisma.rsvpBuffer.findUnique({ where: { email: key } })
		if (existing?.userId && existing.userId !== v.id) continue
		if (existing?.airtableRecordId === row.id && existing?.userId === v.id) continue
		try {
			await prisma.rsvpBuffer.upsert({
				create: {
					airtableRecordId: row.id,
					email: key,
					finishedAccountCreation: true,
					syncAttempts: 0,
					syncedToAirtable: false,
					userId: v.id,
				},
				update: {
					airtableRecordId: row.id,
					finishedAccountCreation: true,
					syncAttempts: 0,
					syncedToAirtable: false,
					userId: v.id,
				},
				where: { email: key },
			})
			linked++
		} catch (err) {
			console.error(`[airtable] loops-sync could not link ${row.id} to ${v.id}:`, err)
		}
	}
	return linked
}

/** Every row of the table, indexed by every key available. */
async function signupRows(config: NonNullable<ReturnType<typeof getAirtableConfig>>) {
	const byEmail = new Map<string, AirtableRecord>()
	const byUserId = new Map<string, AirtableRecord>()
	// Every column this sync reads or writes, asked once through the shared probe: Airtable refuses the whole list request when a `fields[]` entry names a column the table lacks, so asking for the Loops columns unconditionally is the same wholesale-422 class the drain already probes around (see lib/airtable/field-probe). Columns that do not exist are neither requested nor written.
	const all = [
		LOOPS_FIELDS.email,
		LOOPS_FIELDS.userId,
		LOOPS_FIELDS.lastLoginAt,
		LOOPS_FIELDS.lastEntryAt,
		...WEEKS.map(LOOPS_FIELDS.week),
		...WEEKS.map(LOOPS_FIELDS.submitted),
	]
	const writable = await existingColumns(config, TABLE, all)
	const want = all.filter(c => writable.has(c))
	const fieldsQs = want.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listSignups", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(TABLE)}?pageSize=100${fieldsQs ? `&${fieldsQs}` : ""}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records) {
			const email = r.fields[LOOPS_FIELDS.email]
			// First row wins if the list has the same address twice.
			if (typeof email === "string" && !byEmail.has(email.trim().toLowerCase()))
				byEmail.set(email.trim().toLowerCase(), r)
			const userId = r.fields[LOOPS_FIELDS.userId]
			if (typeof userId === "string" && !byUserId.has(userId.trim())) byUserId.set(userId.trim(), r)
		}
		;({ offset } = page)
	} while (offset)
	return { byEmail, byUserId, writable }
}

export interface LoopsSyncResult {
	/**
	 * True when the join matched so little that this run should not be believed. Set rather than merely logged, because the way this failed for months was a run that reported success having written nothing.
	 */
	degraded: boolean
	dryRun: boolean
	matched: number
	/** Rows found only by email, because the row had no user id on it. */
	matchedByEmail: number
	/** Rows found by `Half-Life User ID`. */
	matchedById: number
	/** Rows found by the Airtable record id the RSVP drain recorded. */
	matchedByRecord: number
	/** In a dry run, the first few updates that would be sent. */
	preview?: { email: string; fields: { [_: string]: unknown } }[]
	/** Buffer rows newly linked to their Signups row this run (0 on a dry run). */
	relinked: number
	unchanged: number
	/** Half Life users with no row in Signups. */
	unmatched: number
	updated: number
	users: number
}

/**
 * Bring the Loops columns up to date for everyone. Sends only rows whose values changed, ten per request (Airtable's limit), so an hourly run costs a listing and a handful of writes.
 */
export async function syncLoopsProperties(
	opts: { dryRun?: boolean } = {},
): Promise<LoopsSyncResult | { skipped: string }> {
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }

	const [values, listed, byRecordId] = await Promise.all([loopsValues(), signupRows(config), drainedRecordRows()])
	// The drained rows are the join, not a fallback for it: a record id addresses the row directly, so a person the listing never held is still writable.
	const rows = { ...listed, byRecordId }
	// A dry run promises no writes, so it must not persist links either – it reports the match as-is.
	const relinked = opts.dryRun ? 0 : await persistRecordLinks(values, listed.byEmail, byRecordId)
	const updates: { id: string; email: string; fields: { [_: string]: unknown } }[] = []
	let matched = 0
	let matchedById = 0
	let matchedByRecord = 0
	let matchedByEmail = 0
	let same = 0
	for (const v of values) {
		const hit = resolveSignupRow(v, rows)
		if (!hit) continue
		matched++
		if (hit.by === "id") matchedById++
		else if (hit.by === "record") matchedByRecord++
		else matchedByEmail++
		const fields = fieldsFor(v)
		// Only what the table actually has: one absent column in a PATCH must not fail the nine that exist.
		const writableFields = Object.fromEntries(Object.entries(fields).filter(([k]) => listed.writable.has(k)))
		if (Object.keys(writableFields).length === 0) {
			same++
			continue
		}
		if (unchanged(hit.row, writableFields)) same++
		else updates.push({ email: v.email, fields: writableFields, id: hit.row.id })
	}

	// Half the population, matching nothing, is a broken join rather than a quiet morning. Small populations are exempt: half of four users is noise, and the first signups of a new season legitimately have no Signups row yet.
	const degraded = values.length >= 50 && matched * 2 < values.length
	const result: LoopsSyncResult = {
		degraded,
		dryRun: Boolean(opts.dryRun),
		matched,
		matchedByEmail,
		matchedById,
		matchedByRecord,
		relinked,
		unchanged: same,
		unmatched: values.length - matched,
		updated: updates.length,
		users: values.length,
	}

	// A join that stops matching does not throw: rows are skipped and counted, so the run reports success while writing nothing, and the only symptom is that the columns stay empty. That is precisely how this went unnoticed, so a collapse in the match rate is called out loudly rather than returned as a number somebody has to notice. Most often it means the base has no `Half-Life User ID` column, or the RSVP drain has not been running to fill it – either way the fix is on the Airtable side, not here.
	if (degraded)
		console.error(
			`[airtable] Loops sync matched only ${matched}/${values.length} Half Life users to a Signups row `
				+ `(${matchedById} by id, ${matchedByRecord} by drained record id, ${matchedByEmail} by email) – `
				+ `${result.unmatched} were skipped and their Loops columns left empty. In order of likelihood: `
				+ "their rsvp-drain row hit the attempt cap while the table was missing a column the drain sends, and a "
				+ "row at the cap is never retried – reset `syncAttempts` on those to give them another go; "
				+ "their Signups row was written straight from the landing page with no buffer entry naming it, so neither the user id nor the record id joins can reach it; "
				+ "or the person never had a Signups row at all.",
		)

	if (opts.dryRun) {
		result.preview = updates.slice(0, 5).map(({ email, fields }) => ({ email, fields }))
		return result
	}

	for (let i = 0; i < updates.length; i += 10) {
		const batch = updates.slice(i, i + 10)
		await withRateLimitRetry("updateSignups", () =>
			airtableFetch(config, encodeURIComponent(TABLE), {
				body: JSON.stringify({
					records: batch.map(({ id, fields }) => ({ fields, id })),
					typecast: false,
				}),
				method: "PATCH",
			}),
		)
	}
	return result
}

/**
 * Tick (or untick) one week's `ProjectSubmitted` box for one person, immediately.
 *
 * The hourly `loops-sync` heals these columns eventually, but Loops triggers off a hand-in – waiting up to an hour to say "week 3 is submitted" is waiting too long. So the submit route calls this in its `after` hook, and the unsubmit route calls it too: the value is recomputed from Postgres rather than forced true, so a week taken back with no other hand-in is cleared rather than left ticked.
 *
 * Best-effort by design: a missing column, a missing row, or no Airtable config is a skip, not a throw, so a slow or half-built base never fails a hand-in. A real Airtable fault throws, and the caller logs it – the hourly sync replays the same value later.
 */
export async function syncLoopsWeekSubmitted(
	userId: string,
	week: number,
): Promise<{ updated: boolean } | { skipped: string }> {
	if (!Number.isInteger(week) || week < 1 || week > 10) return { skipped: "not_a_program_week" }
	const config = getAirtableConfig()
	if (!config) return { skipped: "not_configured" }
	const column = LOOPS_FIELDS.submitted(week)
	if (!(await columnExists(config, TABLE, column))) return { skipped: "no_column" }

	const user = await prisma.user.findUnique({ select: { email: true }, where: { id: userId } })
	if (!user) return { skipped: "no_user" }

	// Recomputed, not forced: submit lands with the row present (true), unsubmit lands with it deleted (false unless another hand-in for the same week stands).
	const projects = await prisma.themeProject.findMany({
		select: { submissions: { select: { phase: true, scheduledWeek: true } }, theme: true },
		where: { userId },
	})
	let want = false
	for (const p of projects) {
		for (const s of p.submissions)
			if ((s.scheduledWeek ?? scheduledWeekFor(p.theme, s.phase)) === week) {
				want = true
				break
			}

		if (want) break
	}

	// The drained record id addresses the row without a table scan. Otherwise fall back to the same filtered lookups the bulk sync resolves with.
	const buf = await prisma.rsvpBuffer.findFirst({
		select: { airtableRecordId: true },
		where: { userId },
	})
	const fieldsQs = `fields%5B%5D=${encodeURIComponent(column)}`
	const getById = (id: string) =>
		withRateLimitRetry("readSignup", () =>
			airtableFetch<AirtableRecord>(config, `${encodeURIComponent(TABLE)}/${encodeURIComponent(id)}?${fieldsQs}`),
		).catch(() => null)
	const findByFormula = (formula: string) =>
		withRateLimitRetry("findSignup", () =>
			airtableFetch<{ records: AirtableRecord[] }>(
				config,
				`${encodeURIComponent(TABLE)}?maxRecords=1&filterByFormula=${encodeURIComponent(formula)}&${fieldsQs}`,
			),
		)

	if (buf?.airtableRecordId) {
		const row = await getById(buf.airtableRecordId)
		if (row && (row.fields[column] === true) === want) return { skipped: "already_set" }
		if (row) {
			await withRateLimitRetry("updateSignupSubmitted", () =>
				airtableFetch(config, encodeURIComponent(TABLE), {
					body: JSON.stringify({ records: [{ fields: { [column]: want }, id: row.id }], typecast: false }),
					method: "PATCH",
				}),
			)
			return { updated: true }
		}
		// The recorded row is gone from the base; fall through to the filtered lookups rather than giving up.
	}

	// filterByFormula names columns by name, never by id – so these use the schema names, not the probed keys.
	const byUserId = await findByFormula(`{${RSVP.fields.userId.name}}='${escapeAirtableValue(userId)}'`)
	let [row] = byUserId.records
	if (!row) {
		const byEmail = await findByFormula(
			`LOWER({${RSVP.fields.email.name}})='${escapeAirtableValue(user.email.trim().toLowerCase())}'`,
		)
		;[row] = byEmail.records
	}
	if (!row) return { skipped: "no_row" }
	if ((row.fields[column] === true) === want) return { skipped: "already_set" }
	await withRateLimitRetry("updateSignupSubmitted", () =>
		airtableFetch(config, encodeURIComponent(TABLE), {
			body: JSON.stringify({ records: [{ fields: { [column]: want }, id: row.id }], typecast: false }),
			method: "PATCH",
		}),
	)
	return { updated: true }
}
