import { readFileSync } from "node:fs"
import { BOM_MARGIN_USD } from "../src/lib/bom-policy"
import { starterProjectsFor } from "../src/lib/config/onboarding"
import { getTier } from "../src/lib/config/tiers"
import { HcbGrantCardStatus, Phase, Theme } from "../src/lib/enums"
import { GRANT_CARD_CSV_HEADER, quoteField } from "../src/lib/grant-card-csv"
import { grantCardProjectUrl } from "../src/lib/grant-card-policy"
import { configuredOrigin } from "../src/lib/origin"
import { safeDecrypt } from "../src/lib/pii"
import db from "../src/lib/prisma8"
import { countryOfTimezone } from "../src/lib/regions"

/**
 * An HCB card grant import for a list of makers, for buying a Starbie PCB rather than all the parts.
 *
 * Takes a list of email addresses, as arguments or on stdin (separated by spaces, commas or newlines), and prints a CSV in the format of `card_grants_template.csv` for HCB's bulk import. Every row has the same fields: one-time-use off, no locks, the purpose "Starbie PCB", the instructions ending with a link to the maker's Starbie project, and the invite message "Order your Starbie PCB! Your Starbie kit will arrive soon."
 *
 * The amount is $10 (1000 cents) for most makers. Makers whose location is India, Pakistan, Egypt or Morocco get the amount they were already granted for their design instead, capped at their tier's maximum plus the $3 BOM margin. The location is the country of the user's timezone (`countryOfTimezone`), and also the decrypted address country where one is held. Either one matching makes the maker a capped-amount maker.
 *
 * The previous amount is the design grant on the maker's Starbie project, read in the order the app issues them: a live API card grant, then a sent top-up, then a CSV import. A maker in one of those countries with no previous grant, or whose project has no tier, is left out and reported on stderr, because there is no amount to pay.
 *
 * The instructions end with a link to the maker's Starbie project (`/projects/<id>` on the configured origin, as in `grantCardProjectUrl`). A maker with no Starbie project is still printed, without a link, and reported on stderr; so is a run with no configured origin.
 *
 * An address not found in the database is not printed, and neither is a maker who appears twice. Both are reported on stderr, so nothing is dropped silently.
 *
 * Read-only and database-only:
 *
 *   bun --conditions=react-server scripts/starbie-pcb-grant-cards.ts maker@example.com other@example.com > starbie-pcb.csv
 *   bun --conditions=react-server scripts/starbie-pcb-grant-cards.ts < emails.txt > starbie-pcb.csv
 */

const CAPPED_COUNTRIES: ReadonlySet<string> = new Set(["India", "Pakistan", "Egypt", "Morocco"])
const AMOUNT_CENTS = 1000
const PURPOSE = "Starbie PCB"
const INSTRUCTIONS = "Only spend this on a PCB for your Starbie kit"
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

/** The design grant each project already received, in cents: a live card grant, else a sent top-up, else a CSV import. */
async function previousGrantsByProject(projectIds: string[]): Promise<Map<string, number>> {
	const previous = new Map<string, number>()
	if (projectIds.length === 0) return previous

	const cards = await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
		.where(card => card.status.in([HcbGrantCardStatus.ISSUED, HcbGrantCardStatus.AMBIGUOUS]))
		.where(card => card.supersededAt.isNull())
		.where(card => card.themeProjectId.in(projectIds))
		.select("amountCents", "themeProjectId")
		.all()
	const topUps = await db.orm.public.HcbGrantTopUp.where({ phase: Phase.DESIGN })
		.where(topUp => topUp.sentAt.isNotNull())
		.where(topUp => topUp.themeProjectId.in(projectIds))
		.select("amountCents", "themeProjectId")
		.all()
	const csvRows = await db.orm.public.HcbCardGrantExportRow.where(row => row.themeProjectId.in(projectIds))
		.select("amountCents", "themeProjectId")
		.all()

	for (const row of [...cards, ...topUps, ...csvRows])
		if (!previous.has(row.themeProjectId)) previous.set(row.themeProjectId, row.amountCents)
	return previous
}

async function main(): Promise<void> {
	const emails = readEmails()
	if (emails.length === 0) throw new Error("No email addresses given, as arguments or on stdin")

	const users = await db.orm.public.User.where(user => user.email.in(emails))
		.select("email", "encryptedAddressCountry", "id", "timezone")
		.all()
	const byEmail = new Map(users.map(user => [user.email.toLowerCase(), user]))

	const starterIds = starterProjectsFor(Theme.PCB).map(starter => starter.id)
	const starterProjects = await db.orm.public.ThemeProject.where({ deletedAt: null })
		.where(project => project.userId.in(users.map(user => user.id)))
		.where(project => project.starterProjectId.in(starterIds))
		.select("id", "tier", "userId")
		.all()
	const projectByUser = new Map(starterProjects.map(project => [project.userId, project]))
	const previous = await previousGrantsByProject(starterProjects.map(project => project.id))

	const origin = configuredOrigin()
	if (!origin)
		console.error("NEXT_PUBLIC_APP_URL and BETTER_AUTH_URL are unset, so instructions will have no project link")

	const lines = [GRANT_CARD_CSV_HEADER.join(",")]
	let included = 0
	const missing: string[] = []
	const capped: string[] = []
	const noPrevious: string[] = []
	const noProject: string[] = []
	for (const email of emails) {
		const user = byEmail.get(email.toLowerCase())
		if (!user) {
			missing.push(email)
			continue
		}
		const project = projectByUser.get(user.id)
		const addressCountry = safeDecrypt(user.encryptedAddressCountry)
		const timezoneCountry = countryOfTimezone(user.timezone)
		const isCapped =
			CAPPED_COUNTRIES.has(timezoneCountry) || (addressCountry !== null && CAPPED_COUNTRIES.has(addressCountry))

		let amountCents = AMOUNT_CENTS
		if (isCapped) {
			const tier = project?.tier
			const tierUsd = tier === null || tier === undefined ? undefined : getTier(tier)?.grantUsd
			const previousCents = project ? previous.get(project.id) : undefined
			if (tierUsd === undefined || previousCents === undefined) {
				noPrevious.push(email)
				continue
			}
			const capCents = Math.round((tierUsd + BOM_MARGIN_USD) * 100)
			amountCents = Math.min(previousCents, capCents)
			capped.push(`${email} (${addressCountry ?? timezoneCountry}): ${amountCents} cents`)
		}

		included += 1
		if (!project) noProject.push(email)
		const link = project ? grantCardProjectUrl(project.id, origin) : null
		const instructions = link ? `${INSTRUCTIONS} – ${link}` : INSTRUCTIONS
		const fields = [
			user.email,
			String(amountCents),
			PURPOSE,
			instructions,
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
	for (const entry of capped) console.error(`capped at tier maximum + $${BOM_MARGIN_USD}: ${entry}`)
	for (const email of noPrevious) console.error(`skipped, no previous grant or tier to cap at: ${email}`)
	for (const email of noProject) console.error(`no Starbie project, so no link: ${email}`)
	for (const email of missing) console.error(`not found: ${email}`)
	console.error(
		`${included} card(s) written, ${capped.length} capped, ${noPrevious.length} skipped, ${missing.length} not found`,
	)
}

await main()
