import "dotenv/config"
import { type AirtableRecord, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { existingColumns } from "../src/lib/airtable/field-probe"
import { LOOPS_FIELDS, resolveSignupRow } from "../src/lib/airtable/loops"
import { fieldKey, RSVP, RSVP_TABLE_ID } from "../src/lib/airtable/schema"
import { scheduledWeekFor } from "../src/lib/config/program"
import prisma from "../src/lib/prisma"

/**
 * Backfill the `Loops - halfLifeWeek{n}ProjectSubmitted` checkboxes on the Signups table.
 *
 * These boxes are ticked live on submit (see `syncLoopsWeekSubmitted` in lib/airtable/loops) and healed hourly by `loops-sync`, which now covers them. Rows from before the live tick landed carry nothing, so this replays the state Postgres already holds onto them: week n is ticked when any hand-in exists for that scheduled week, in any state.
 *
 * Only the ten submitted boxes are ever written – the rest of the Loops columns are left alone, so this is safe to run even while the hourly sync owns them. Rows whose boxes already agree are left untouched, so a second run writes nothing.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-loops-submitted.ts [--commit]`.
 * In production run it where `DATABASE_URL` and the Airtable secrets both point at the live base, not from a dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")
const WEEKS = Array.from({ length: 10 }, (_, i) => i + 1)

/** Every Signups row, indexed by every key the sync resolves with. */
async function signupRows(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
	columns: string[],
): Promise<{ byEmail: Map<string, AirtableRecord>; byUserId: Map<string, AirtableRecord> }> {
	const byEmail = new Map<string, AirtableRecord>()
	const byUserId = new Map<string, AirtableRecord>()
	const emailKey = LOOPS_FIELDS.email
	const userIdKey = fieldKey(RSVP.fields.userId)
	const fieldsQs = columns.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listSignupsSubmitted", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(RSVP_TABLE_ID)}?pageSize=100${fieldsQs ? `&${fieldsQs}` : ""}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records) {
			const email = r.fields[emailKey]
			if (typeof email === "string" && !byEmail.has(email.trim().toLowerCase()))
				byEmail.set(email.trim().toLowerCase(), r)
			const userId = r.fields[userIdKey]
			if (typeof userId === "string" && !byUserId.has(userId.trim())) byUserId.set(userId.trim(), r)
		}
		offset = page.offset
	} while (offset)
	return { byEmail, byUserId }
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const wanted = WEEKS.map(LOOPS_FIELDS.submitted)
	const writable = await existingColumns(config, RSVP_TABLE_ID, wanted)
	const columns = wanted.filter(c => writable.has(c))
	if (columns.length === 0) {
		console.error(
			`None of the ${wanted.map(c => `\`${c}\``).join(", ")} columns are on ${RSVP_TABLE_ID}; create them in Airtable before backfilling.`,
		)
		process.exit(1)
	}
	if (columns.length < wanted.length)
		console.log(`Only ${columns.length}/10 submitted columns exist; backfilling those and skipping the rest.`)

	const users = await prisma.user.findMany({
		select: {
			email: true,
			id: true,
			themeProjects: {
				select: { submissions: { select: { phase: true, scheduledWeek: true } }, theme: true },
				where: { deletedAt: null },
			},
		},
	})
	// Week n is ticked when any hand-in exists for that scheduled week, in any state. Rows from before `scheduledWeek` was recorded fall back to the theme and phase's own week; the warm-up's week 0 is not a program week.
	const wantByUser = new Map<string, Set<number>>()
	for (const u of users) {
		const weeks = new Set<number>()
		for (const p of u.themeProjects)
			for (const s of p.submissions) {
				const w = s.scheduledWeek ?? scheduledWeekFor(p.theme, s.phase)
				if (w >= 1 && w <= 10) weeks.add(w)
			}

		wantByUser.set(u.id, weeks)
	}
	const submitters = users.filter(u => (wantByUser.get(u.id)?.size ?? 0) > 0)
	console.log(`Users: ${users.length} (${submitters.length} with at least one hand-in)`)

	const listed = await signupRows(config, [LOOPS_FIELDS.email, fieldKey(RSVP.fields.userId), ...columns])
	const drained = await prisma.rsvpBuffer.findMany({
		select: { airtableRecordId: true, userId: true },
		where: { airtableRecordId: { not: null }, userId: { not: null } },
	})
	const byRecordId = new Map<string, AirtableRecord>()
	for (const row of drained)
		if (row.userId && row.airtableRecordId && !byRecordId.has(row.userId))
			byRecordId.set(row.userId, { fields: {}, id: row.airtableRecordId })

	const updates = new Map<string, { [_: string]: boolean }>()
	let matched = 0
	let unmatched = 0
	let aligned = 0
	for (const u of users) {
		const want = wantByUser.get(u.id) ?? new Set<number>()
		// Nobody to heal for someone who never handed anything in and whose row (if any) the listing already shows as clear – the hourly sync owns that steady state.
		if (want.size === 0) continue
		const hit = resolveSignupRow(u, { ...listed, byRecordId })
		if (!hit) {
			unmatched++
			continue
		}
		matched++
		// A drained placeholder carries no fields to compare against, so its want-state is written blind – checkbox writes are idempotent, and the hourly sync converges anything this over-writes.
		const fields: { [_: string]: boolean } = {}
		for (const c of columns) {
			const n = Number(/Week(\d+)ProjectSubmitted/.exec(c)?.[1])
			const value = want.has(n)
			if (Object.keys(hit.row.fields).length === 0 || (hit.row.fields[c] === true) !== value) fields[c] = value
		}
		if (Object.keys(fields).length === 0) aligned++
		else {
			const prev = updates.get(hit.row.id) ?? {}
			updates.set(hit.row.id, { ...prev, ...fields })
		}
	}

	console.log(
		`matched: ${matched}, unmatched (no Signups row): ${unmatched}, aligned: ${aligned}, to update: ${updates.size}`,
	)
	for (const [id, fields] of [...updates].slice(0, 10)) console.log(`  ${id}  →  ${JSON.stringify(fields)}`)
	if (updates.size > 10) console.log(`  …and ${updates.size - 10} more`)

	if (!commit) {
		console.log("Dry run. Pass --commit to tick the submitted boxes on these rows.")
		return
	}

	let updated = 0
	let failed = 0
	const entries = [...updates]
	for (let i = 0; i < entries.length; i += 10) {
		const batch = entries.slice(i, i + 10)
		try {
			await withRateLimitRetry("updateSignupsSubmitted", () =>
				airtableFetch(config, encodeURIComponent(RSVP_TABLE_ID), {
					body: JSON.stringify({
						records: batch.map(([id, fields]) => ({ fields, id })),
						typecast: false,
					}),
					method: "PATCH",
				}),
			)
			updated += batch.length
			if (updated % 100 === 0) console.log(`updated ${updated}/${entries.length}…`)
		} catch (err) {
			failed += batch.length
			console.error(`  batch failed: ${err instanceof Error ? err.message : String(err)}`)
		}
	}
	console.log(`updated: ${updated}, failed: ${failed}`)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
