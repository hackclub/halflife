import { displayName } from "../src/lib/display-name"
import { HcbGrantCardStatus, Phase } from "../src/lib/enums"
import { grantCardCapUsd } from "../src/lib/grant-card-policy"
import db from "../src/lib/prisma8"

/**
 * Every grant card issued for more than its design's maximum, one line per card: the source, the maker, the project, the amount sent, the maximum, and how far over it went.
 *
 * The maximum is the lower of the project's approved grant and its tier's `grantUsd` (see `grantCardCapUsd`). The amount is what Half Life sent to HCB, recorded on the row when the card was created, imported or topped up. That is the figure the card was issued for. It is not read back from HCB, so a balance changed on HCB after issue is not reflected here.
 *
 * Three sources are checked, as in `lib/grant-cards`:
 *
 * - `api`: an API card grant (`HcbGrantCard`) that is `ISSUED` or `AMBIGUOUS` and not superseded. Has a link.
 * - `topup`: a top-up into an existing card grant (`HcbGrantTopUp`) that was sent. Has a link.
 * - `csv`: a row from an HCB CSV import (`HcbCardGrantExportRow`). The CSV keeps no HCB id, so it has no link.
 *
 * Read-only and database-only: no HCB credentials are needed, so it runs anywhere the database is reachable.
 *
 *   bun --conditions=react-server scripts/over-cap-grant-cards.ts
 *   bun --conditions=react-server scripts/over-cap-grant-cards.ts > over-cap.tsv
 *
 * A project with no tier has no maximum, so every card on it is listed as `no tier`. The summary goes to stderr.
 */

interface Issued {
	amountCents: number
	hashid: string | null
	projectId: string
	source: "api" | "topup" | "csv"
}

const dollars = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** Tabs and newlines would break the one-line-per-card shape. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

async function main(): Promise<void> {
	const cards = await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
		.where(card => card.status.in([HcbGrantCardStatus.ISSUED, HcbGrantCardStatus.AMBIGUOUS]))
		.where(card => card.supersededAt.isNull())
		.select("amountCents", "hcbCardGrantId", "themeProjectId")
		.all()
	const topUps = await db.orm.public.HcbGrantTopUp.where({ phase: Phase.DESIGN })
		.where(topUp => topUp.sentAt.isNotNull())
		.select("amountCents", "grantHashid", "themeProjectId")
		.all()
	const csvRows = await db.orm.public.HcbCardGrantExportRow.select("amountCents", "themeProjectId").all()

	const issued: Issued[] = [
		...cards.map(card => ({
			amountCents: card.amountCents,
			hashid: card.hcbCardGrantId,
			projectId: card.themeProjectId,
			source: "api" as const,
		})),
		...topUps.map(topUp => ({
			amountCents: topUp.amountCents,
			hashid: topUp.grantHashid,
			projectId: topUp.themeProjectId,
			source: "topup" as const,
		})),
		...csvRows.map(row => ({
			amountCents: row.amountCents,
			hashid: null,
			projectId: row.themeProjectId,
			source: "csv" as const,
		})),
	]

	const projectIds = [...new Set(issued.map(card => card.projectId))]
	const projects = await db.orm.public.ThemeProject.where(project => project.id.in(projectIds))
		.select("grantUsd", "id", "tier", "title")
		.include("user", user => user.select("displayName", "email", "name"))
		.all()
	const projectById = new Map(projects.map(project => [project.id, project]))

	const lines: string[] = []
	let over = 0
	for (const card of issued) {
		const project = projectById.get(card.projectId)
		if (!project?.user) continue
		const capUsd = grantCardCapUsd(project.grantUsd, project.tier)
		const capCents = capUsd === null ? null : Math.round(capUsd * 100)
		const overBy = capCents === null ? card.amountCents : card.amountCents - capCents
		if (capCents !== null && overBy <= 0) continue
		over += 1
		const link = card.hashid ? `https://hcb.hackclub.com/grants/${card.hashid}` : "-"
		const cap = capCents === null ? "no tier" : dollars(capCents)
		const excess = capCents === null ? "n/a" : dollars(overBy)
		lines.push(
			[
				card.source,
				oneLine(displayName(project.user, "(no name)")),
				oneLine(project.user.email),
				oneLine(project.title),
				dollars(card.amountCents),
				cap,
				excess,
				link,
			].join("\t"),
		)
	}

	lines.sort()
	for (const line of lines) console.log(line)
	console.error(`${over} card(s) issued over their maximum, out of ${issued.length} card(s) checked`)
}

await main()
