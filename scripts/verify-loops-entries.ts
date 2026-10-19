import "dotenv/config"
import { HoursSource } from "../src/app/generated/prisma/enums"
import { type AirtableRecord, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { LOOPS_FIELDS } from "../src/lib/airtable/loops"
import { RSVP_TABLE_ID } from "../src/lib/airtable/schema"
import prisma from "../src/lib/prisma"

/**
 * Audit the `Loops - halfLifeLastEntryAt` column against the devlog rule.
 *
 * The sync only writes rows it can join to a Half Life user, so two kinds of
 * row can carry a stale (or never-should-have-existed) timestamp:
 *
 * 1. Matched stale rows – the row joins to a user who now has no real entry
 *    (only Hackatime-linked sessions). The next `loops-sync` run clears these.
 * 2. Unmatched rows – the row has no join to any user, so nothing will ever
 *    rewrite or clear it. These need a manual clear in Airtable (or a fixed
 *    join), which is why they are listed separately.
 *
 * Read-only by default. With `--clear`, type 1 rows are PATCHed to null; type
 * 2 rows are only reported, since clearing what we cannot match risks
 * deleting a value that is actually correct. Run with
 * `pnpm verify:loops-entries [--clear]`.
 */

const clear = process.argv.includes("--clear")

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	// Every Signups row carrying a timestamp, plus the keys the join needs.
	const withTimestamp: AirtableRecord[] = []
	const want = [LOOPS_FIELDS.email, LOOPS_FIELDS.userId, LOOPS_FIELDS.lastEntryAt]
	const fieldsQs = want.map(f => `fields%5B%5D=${encodeURIComponent(f)}`).join("&")
	let offset: string | undefined
	do {
		const page = await withRateLimitRetry("listSignups", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(RSVP_TABLE_ID)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		for (const r of page.records) if (r.fields[LOOPS_FIELDS.lastEntryAt]) withTimestamp.push(r)
		offset = page.offset
	} while (offset)
	console.log(`Signups rows with a lastEntryAt: ${withTimestamp.length}`)

	// The people who genuinely have an entry: a written devlog or a timelapse.
	const qualifiers = await prisma.user.findMany({
		select: { email: true, id: true },
		where: {
			themeProjects: {
				some: {
					deletedAt: null,
					workSessions: {
						some: {
							deletedAt: null,
							OR: [{ hoursSource: { not: HoursSource.HACKATIME_TRACKED } }, { timelapses: { some: {} } }],
						},
					},
				},
			},
		},
	})
	const qualifiedIds = new Set(qualifiers.map(u => u.id))
	const qualifiedEmails = new Map(qualifiers.map(u => [u.email.trim().toLowerCase(), u.id]))

	// The join keys the sync would use: the row's own user id column, the RSVP
	// drain's record id, and email.
	const buffers = await prisma.rsvpBuffer.findMany({
		select: { airtableRecordId: true, email: true, userId: true },
	})
	const bufferByRecord = new Map<string, string>()
	const bufferByEmail = new Map<string, string>()
	for (const b of buffers) {
		if (b.airtableRecordId && b.userId && !bufferByRecord.has(b.airtableRecordId))
			bufferByRecord.set(b.airtableRecordId, b.userId)
		if (b.userId && !bufferByEmail.has(b.email.trim().toLowerCase()))
			bufferByEmail.set(b.email.trim().toLowerCase(), b.userId)
	}
	const usersByEmail = new Map<string, string>()
	for (const u of await prisma.user.findMany({ select: { email: true, id: true } }))
		usersByEmail.set(u.email.trim().toLowerCase(), u.id)

	const matchedStale: AirtableRecord[] = []
	const unmatched: AirtableRecord[] = []
	let fine = 0
	for (const r of withTimestamp) {
		const rowUserId = r.fields[LOOPS_FIELDS.userId]
		const rowEmail = r.fields[LOOPS_FIELDS.email]
		const userId =
			(typeof rowUserId === "string" && rowUserId)
			|| bufferByRecord.get(r.id)
			|| (typeof rowEmail === "string"
				&& (bufferByEmail.get(rowEmail.trim().toLowerCase()) ?? usersByEmail.get(rowEmail.trim().toLowerCase())))
			|| null
		if (!userId) {
			unmatched.push(r)
			continue
		}
		if (
			qualifiedIds.has(userId)
			|| qualifiedEmails.has(typeof rowEmail === "string" ? rowEmail.trim().toLowerCase() : "")
		)
			fine++
		else matchedStale.push(r)
	}

	console.log(`fine (user has a real entry): ${fine}`)
	console.log(`matched stale (user has only Hackatime evidence): ${matchedStale.length}`)
	console.log(`unmatched rows (no join to any user): ${unmatched.length}`)
	for (const r of unmatched.slice(0, 20))
		console.log(
			`  unmatched ${r.id} email=${(r.fields[LOOPS_FIELDS.email] as string | undefined) ?? "?"} value=${String(r.fields[LOOPS_FIELDS.lastEntryAt] as string | undefined)}`,
		)
	if (unmatched.length > 20) console.log(`  …and ${unmatched.length - 20} more`)

	if (!clear) {
		console.log(
			"Dry run. Pass --clear to null the matched stale rows; unmatched rows always need Airtable/manual handling.",
		)
		return
	}
	for (let i = 0; i < matchedStale.length; i += 10) {
		const batch = matchedStale.slice(i, i + 10)
		await withRateLimitRetry("clearLastEntryAt", () =>
			airtableFetch(config, encodeURIComponent(RSVP_TABLE_ID), {
				body: JSON.stringify({
					records: batch.map(r => ({ fields: { [LOOPS_FIELDS.lastEntryAt]: null }, id: r.id })),
					typecast: false,
				}),
				method: "PATCH",
			}),
		)
	}
	console.log(`Cleared lastEntryAt on ${matchedStale.length} matched stale rows.`)
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
