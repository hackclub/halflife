import "dotenv/config"
import { type AirtableRecord, airtableFetch, getAirtableConfig, withRateLimitRetry } from "../src/lib/airtable/client"
import { LOOPS_FIELDS, syncLoopsProperties } from "../src/lib/airtable/loops"
import { RSVP_TABLE_ID } from "../src/lib/airtable/schema"
import prisma from "../src/lib/prisma"

/**
 * Backfill the Loops columns for all existing users.
 *
 * Two phases, both mapped-rows-only – no Airtable row is ever created, so an
 * address that never signed up on the landing page stays out of the list:
 *
 * 1. Relink. The landing form used to write straight to Airtable without
 *    leaving an `RsvpBuffer` entry, so the Loops sync's record-id join cannot
 *    reach those rows. Wherever a `User.email` still matches a Signups row,
 *    record that row's id (and the user id) on the buffer row, so the drain
 *    stamps `Half-Life User ID` and the sync matches by record id from then
 *    on. Users whose address no longer matches any row are reported, not
 *    guessed at – there is no other signal linking them to a landing row.
 * 2. Sync. Run the normal `loops-sync` over everyone, which PATCHes the Loops
 *    columns onto every matched row.
 *
 * Read-only unless `--commit` is passed. Run with
 * `bun --conditions=react-server scripts/backfill-loops.ts [--commit]`.
 * In production run it where
 * `DATABASE_URL` points at the real database (the Orchard pod), not from a
 * dev machine against a local Postgres.
 */

const commit = process.argv.includes("--commit")

async function listSignupEmails(
	config: NonNullable<ReturnType<typeof getAirtableConfig>>,
): Promise<{ byEmail: Map<string, string>; total: number }> {
	const byEmail = new Map<string, string>()
	let total = 0
	let offset: string | undefined
	const fieldsQs = `fields%5B%5D=${encodeURIComponent(LOOPS_FIELDS.email)}`
	do {
		const page = await withRateLimitRetry("listSignupEmails", () =>
			airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
				config,
				`${encodeURIComponent(RSVP_TABLE_ID)}?pageSize=100&${fieldsQs}${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`,
			),
		)
		total += page.records.length
		for (const r of page.records) {
			const email = r.fields[LOOPS_FIELDS.email]
			if (typeof email === "string" && !byEmail.has(email.trim().toLowerCase()))
				byEmail.set(email.trim().toLowerCase(), r.id)
		}
		offset = page.offset
	} while (offset)
	return { byEmail, total }
}

async function main() {
	const config = getAirtableConfig()
	if (!config) {
		console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")
		process.exit(1)
	}

	const { byEmail: recordByEmail, total } = await listSignupEmails(config)
	console.log(`Signups rows: ${total} (${recordByEmail.size} with an email)`)

	const users = await prisma.user.findMany({ select: { id: true, email: true } })
	const buffers = await prisma.rsvpBuffer.findMany({
		select: { email: true, userId: true, airtableRecordId: true, syncedToAirtable: true },
	})
	const bufferByEmail = new Map(buffers.map(b => [b.email.trim().toLowerCase(), b]))
	console.log(`Users: ${users.length}, buffer rows: ${buffers.length}`)

	let alreadyLinked = 0
	let linked = 0
	let unmappable = 0
	const pending: { email: string; userId: string; recordId: string; hasRow: boolean }[] = []
	for (const u of users) {
		const key = u.email.trim().toLowerCase()
		const recordId = recordByEmail.get(key)
		if (!recordId) {
			unmappable++
			continue
		}
		const buf = bufferByEmail.get(key)
		if (buf?.airtableRecordId === recordId && buf?.userId === u.id) {
			alreadyLinked++
			continue
		}
		pending.push({ email: key, userId: u.id, recordId, hasRow: !!buf })
	}

	if (!commit) {
		console.log(
			`[dry run] already linked: ${alreadyLinked}, would link: ${pending.length}, unmappable (no Signups row for this email): ${unmappable}`,
		)
	} else {
		for (const p of pending) {
			if (p.hasRow) {
				await prisma.rsvpBuffer.update({
					where: { email: p.email },
					data: {
						userId: p.userId,
						airtableRecordId: p.recordId,
						finishedAccountCreation: true,
						syncedToAirtable: false,
						syncAttempts: 0,
					},
				})
			} else {
				await prisma.rsvpBuffer.create({
					data: {
						email: p.email,
						userId: p.userId,
						airtableRecordId: p.recordId,
						finishedAccountCreation: true,
						syncedToAirtable: false,
					},
				})
			}
			linked++
			if (linked % 100 === 0) console.log(`linked ${linked}/${pending.length}…`)
		}
		console.log(
			`already linked: ${alreadyLinked}, newly linked: ${linked}, unmappable (no Signups row for this email): ${unmappable}`,
		)
		console.log(
			"Note: linked rows still need the rsvp-drain to PATCH `Half-Life User ID` upstream; it works through its queue on its own schedule.",
		)
	}

	const result = await syncLoopsProperties({ dryRun: !commit })
	if ("skipped" in result) {
		console.log(`loops sync skipped: ${result.skipped}`)
	} else {
		console.log(
			`loops sync (${result.dryRun ? "dry run" : "commit"}): users=${result.users} matched=${result.matched} `
				+ `(by id=${result.matchedById}, by record=${result.matchedByRecord}, by email=${result.matchedByEmail}) `
				+ `relinked=${result.relinked} unmatched=${result.unmatched} updated=${result.updated} unchanged=${result.unchanged} degraded=${result.degraded}`,
		)
		if (result.preview?.length) console.log("preview:", JSON.stringify(result.preview, null, 1))
		if (!commit) console.log("Pass --commit to link buffer rows and write the Loops columns.")
	}
}

main()
	.catch(err => {
		console.error(err)
		process.exitCode = 1
	})
	.finally(() => prisma.$disconnect())
