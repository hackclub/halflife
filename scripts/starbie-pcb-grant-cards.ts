import { readFileSync } from "node:fs"
import { GRANT_CARD_CSV_HEADER, quoteField } from "../src/lib/grant-card-csv"
import { safeDecrypt } from "../src/lib/pii"
import db from "../src/lib/prisma8"
import { countryOfTimezone } from "../src/lib/regions"

/**
 * An HCB card grant import for a list of makers: $10 each, for buying a Starbie PCB rather than all the parts.
 *
 * Takes a list of email addresses, as arguments or on stdin (separated by spaces, commas or newlines), and prints a CSV in the format of `card_grants_template.csv` for HCB's bulk import. Every row is $10 (1000 cents), one-time-use off and no locks, with the purpose "Starbie PCB" and the invite message "Order your Starbie PCB! Your Starbie kit will arrive soon."
 *
 * Makers whose location is India, Pakistan, Egypt or Morocco are left out. The location is the country of the user's timezone (`countryOfTimezone`, the same mapping the admin country breakdown uses), and also the decrypted address country where one is held. Either one matching excludes the maker.
 *
 * An address not found in the database is not printed, and neither is a maker who appears twice. Both are reported on stderr, as are the excluded makers, so nothing is dropped silently.
 *
 * Read-only and database-only:
 *
 *   bun --conditions=react-server scripts/starbie-pcb-grant-cards.ts maker@example.com other@example.com > starbie-pcb.csv
 *   bun --conditions=react-server scripts/starbie-pcb-grant-cards.ts < emails.txt > starbie-pcb.csv
 */

const EXCLUDED_COUNTRIES: ReadonlySet<string> = new Set(["India", "Pakistan", "Egypt", "Morocco"])
const AMOUNT_CENTS = 1000
const PURPOSE = "Starbie PCB"
const INSTRUCTIONS = "Only spend this on a PCB for your Starbie kit."
const INVITE_MESSAGE = "Order your Starbie PCB! Your Starbie kit will arrive soon."

/** The addresses as typed, one per person: duplicates differing only in case are read as the same maker. */
function readEmails(): string[] {
	const args = process.argv.slice(2)
	const raw = args.length > 0 ? args.join("\n") : readFileSync(0, "utf8")
	const seen = new Map<string, string>()
	for (const entry of raw.split(/[\s,]+/)) {
		const email = entry.trim()
		if (email && !seen.has(email.toLowerCase())) seen.set(email.toLowerCase(), email)
	}
	return [...seen.values()]
}

async function main(): Promise<void> {
	const emails = readEmails()
	if (emails.length === 0) throw new Error("No email addresses given, as arguments or on stdin")

	const users = await db.orm.public.User.where(user => user.email.in(emails))
		.select("email", "encryptedAddressCountry", "id", "timezone")
		.all()
	const byEmail = new Map(users.map(user => [user.email.toLowerCase(), user]))

	const lines = [GRANT_CARD_CSV_HEADER.join(",")]
	let included = 0
	const missing: string[] = []
	const excluded: string[] = []
	for (const email of emails) {
		const user = byEmail.get(email.toLowerCase())
		if (!user) {
			missing.push(email)
			continue
		}
		const addressCountry = safeDecrypt(user.encryptedAddressCountry)
		const timezoneCountry = countryOfTimezone(user.timezone)
		const inExcluded =
			EXCLUDED_COUNTRIES.has(timezoneCountry) || (addressCountry !== null && EXCLUDED_COUNTRIES.has(addressCountry))
		if (inExcluded) {
			excluded.push(`${email} (${addressCountry ?? timezoneCountry})`)
			continue
		}
		included += 1
		const fields = [
			user.email,
			String(AMOUNT_CENTS),
			PURPOSE,
			INSTRUCTIONS,
			"false",
			"false",
			INVITE_MESSAGE,
			"",
			"",
			"",
			"",
			"",
		]
		lines.push(fields.map(quoteField).join(","))
	}

	process.stdout.write(`${lines.join("\n")}\n`)
	for (const email of missing) console.error(`not found: ${email}`)
	for (const entry of excluded) console.error(`excluded (India, Pakistan, Egypt or Morocco): ${entry}`)
	console.error(`${included} card(s) written, ${excluded.length} excluded, ${missing.length} not found`)
}

await main()
