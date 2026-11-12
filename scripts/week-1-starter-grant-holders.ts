import { not } from "@prisma/orm-postgres/orm-client"
import { starterProjectsFor } from "../src/lib/config/onboarding"
import { displayName } from "../src/lib/display-name"
import { HcbGrantCardStatus, Phase, PhaseStatus, Theme } from "../src/lib/enums"
import { listOrganizationCardGrants, readCardGrantSpend } from "../src/lib/hcb"
import db from "../src/lib/prisma8"

/**
 * Every maker whose Week 1 starter project was approved and had a grant issued for it, one line per project: name, email, the grant card's link on HCB, and whether anything has been spent from that card.
 *
 * Week 1 is the PCB week, and its only starter is Starbie (see `lib/config/onboarding`). A starter counts when:
 *
 * - it was taken (`starterProjectId` is one of Week 1's starters) and not deleted;
 * - its design was approved, since the grant is emitted by the design approval;
 * - a grant was issued for it: `grantEmittedAt` is set and `grantUsd` is above zero.
 *
 * A design grant reaches HCB in one of three ways (see `lib/grant-cards`), and each is checked in turn:
 *
 * - an API card grant: a live `HcbGrantCard` (`ISSUED`, not superseded), which has a link;
 * - a top-up into an existing card grant: a sent `HcbGrantTopUp`, whose `grantHashid` is the card grant's id, so it has a link too;
 * - a CSV import: an `HcbCardGrantExportRow`. HCB creates that card from the CSV and we keep no id for it, so the row is matched to HCB's own card grant list by email and amount. A row that matches no grant, or more than one, is reported on its row rather than guessed at.
 *
 * "spent" is `yes` when HCB reports card spend above zero, `no` when it reports zero, and `unknown` when HCB does not say. A project with no grant card shows `no card`, and a card HCB refuses to read shows `error`. Read-only, and safe to run against production:
 *
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts > week-1-grant-holders.tsv
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts --no-hcb
 *
 * Needs `HCB_ORG_SLUG` and either `HCB_ACCESS_TOKEN` or the refresh-token set, as the app does. `--no-hcb` skips every HCB call, so it needs only the database: links for API card grants and top-ups are still printed, while spend and CSV-imported cards are marked as needing HCB auth. The count goes to stderr so a redirected file holds only the rows.
 */

/** Tabs and newlines would break the one-line-per-project shape. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

/** Set by `--no-hcb`: the script reads the database only and never calls HCB. */
const noHcb = process.argv.slice(2).includes("--no-hcb")

interface CardReading {
	grantLink: string
	spent: string
}

/** Read the card's spend from HCB. A failed read is reported on its row, not allowed to stop the list. */
async function readingFor(hashid: string): Promise<CardReading> {
	const grantLink = `https://hcb.hackclub.com/grants/${hashid}`
	if (noHcb) return { grantLink, spent: "needs HCB auth" }
	try {
		const spend = await readCardGrantSpend(hashid)
		const spentCents =
			spend.spentCents
			?? (spend.amountCents !== null && spend.balanceCents !== null ? spend.amountCents - spend.balanceCents : null)
		if (spentCents === null) return { grantLink, spent: "unknown" }
		return { grantLink, spent: spentCents > 0 ? "yes" : "no" }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		return { grantLink, spent: `error: ${oneLine(message)}` }
	}
}

async function main(): Promise<void> {
	const starterIds = starterProjectsFor(Theme.PCB).map(starter => starter.id)

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null, designStatus: PhaseStatus.approved })
		.where(project => project.starterProjectId.in(starterIds))
		.where(project => not(project.grantEmittedAt.isNull()))
		.where(project => project.grantUsd.gt(0))
		.select("id", "userId")
		.include("user", user => user.select("displayName", "email", "name"))
		.all()
	const projectIds = projects.map(project => project.id)

	const cards = await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN, status: HcbGrantCardStatus.ISSUED })
		.where(card => card.supersededAt.isNull())
		.where(card => card.themeProjectId.in(projectIds))
		.select("hcbCardGrantId", "themeProjectId")
		.all()
	const topUps = await db.orm.public.HcbGrantTopUp.where({ phase: Phase.DESIGN })
		.where(topUp => topUp.sentAt.isNotNull())
		.where(topUp => topUp.themeProjectId.in(projectIds))
		.select("grantHashid", "themeProjectId")
		.all()
	const csvRows = await db.orm.public.HcbCardGrantExportRow.where(row => row.supersededAt.isNull())
		.where(row => row.themeProjectId.in(projectIds))
		.select("amountCents", "email", "themeProjectId")
		.all()

	const hashidByProject = new Map<string, string>()
	for (const card of cards) if (card.hcbCardGrantId) hashidByProject.set(card.themeProjectId, card.hcbCardGrantId)
	for (const topUp of topUps)
		if (!hashidByProject.has(topUp.themeProjectId)) hashidByProject.set(topUp.themeProjectId, topUp.grantHashid)

	// A CSV import keeps no HCB id, so each row is matched to HCB's own list of card grants by email and amount.
	const csvByProject = new Map(csvRows.map(row => [row.themeProjectId, row]))
	const unmatchedCsv = [...csvByProject.values()].filter(row => !hashidByProject.has(row.themeProjectId))
	const hcbGrants = unmatchedCsv.length > 0 && !noHcb ? await listOrganizationCardGrants() : null
	if (hcbGrants?.kind === "unreadable") throw new Error("HCB returned a card grant list this script cannot read")

	const csvReadings = new Map<string, CardReading>()
	for (const row of unmatchedCsv) {
		if (noHcb) {
			csvReadings.set(row.themeProjectId, { grantLink: "-", spent: "needs HCB auth (CSV import)" })
			continue
		}
		const email = row.email.trim().toLowerCase()
		const matches = (hcbGrants?.rows ?? []).filter(
			grant => grant.email?.trim().toLowerCase() === email && grant.amountCents === row.amountCents,
		)
		if (matches.length === 1 && matches[0]) {
			hashidByProject.set(row.themeProjectId, matches[0].id)
			continue
		}
		const spent =
			matches.length === 0
				? "no HCB card grant found for this CSV row"
				: `ambiguous: ${matches.length} HCB card grants match`
		csvReadings.set(row.themeProjectId, { grantLink: "-", spent })
	}

	const rows: { email: string; grantLink: string; name: string; spent: string }[] = []
	for (const project of projects) {
		if (!project.user) continue
		const hashid = hashidByProject.get(project.id)
		const reading = hashid
			? await readingFor(hashid)
			: (csvReadings.get(project.id) ?? { grantLink: "-", spent: "no card" })
		rows.push({
			email: project.user.email,
			grantLink: reading.grantLink,
			name: displayName(project.user, "(no name)"),
			spent: reading.spent,
		})
	}

	rows.sort((a, b) => a.name.localeCompare(b.name))
	for (const row of rows) console.log([oneLine(row.name), oneLine(row.email), row.grantLink, row.spent].join("\t"))

	console.error(
		`${rows.length} project(s) with an approved Week 1 starter and an issued grant, ${hashidByProject.size} with a card grant on HCB`,
	)
}

await main()
