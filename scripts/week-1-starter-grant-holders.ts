import { not } from "@prisma/orm-postgres/orm-client"
import { starterProjectsFor } from "../src/lib/config/onboarding"
import { displayName } from "../src/lib/display-name"
import { HcbGrantCardStatus, Phase, PhaseStatus, Theme } from "../src/lib/enums"
import { readCardGrantSpend } from "../src/lib/hcb"
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
 * The grant card is the project's live design card grant (`ISSUED`, not superseded). "spent" is `yes` when HCB reports card spend above zero, `no` when it reports zero, and `unknown` when HCB does not say. A project with no issued card grant shows `no card`, and a card HCB refuses to read shows `error`. Read-only, and safe to run against production:
 *
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts > week-1-grant-holders.tsv
 *
 * Needs `HCB_ORG_SLUG` and either `HCB_ACCESS_TOKEN` or the refresh-token set, as the app does. The count goes to stderr so a redirected file holds only the rows.
 */

/** Tabs and newlines would break the one-line-per-project shape. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

interface SpendReading {
	grantLink: string
	spent: string
}

/** Read the card's spend from HCB, one card at a time. A failed read is reported on its row, not allowed to stop the list. */
async function spendFor(hashid: string | null): Promise<SpendReading> {
	if (!hashid) return { grantLink: "-", spent: "no card" }
	const grantLink = `https://hcb.hackclub.com/grants/${hashid}`
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

	const cards = await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN, status: HcbGrantCardStatus.ISSUED })
		.where(card => card.supersededAt.isNull())
		.where(card => card.themeProjectId.in(projects.map(project => project.id)))
		.select("hcbCardGrantId", "themeProjectId")
		.all()
	const hashidByProject = new Map(cards.map(card => [card.themeProjectId, card.hcbCardGrantId]))

	const rows: { email: string; grantLink: string; name: string; spent: string }[] = []
	for (const project of projects) {
		if (!project.user) continue
		const { grantLink, spent } = await spendFor(hashidByProject.get(project.id) ?? null)
		rows.push({
			email: project.user.email,
			grantLink,
			name: displayName(project.user, "(no name)"),
			spent,
		})
	}

	rows.sort((a, b) => a.name.localeCompare(b.name))
	for (const row of rows) console.log([oneLine(row.name), oneLine(row.email), row.grantLink, row.spent].join("\t"))

	console.error(
		`${rows.length} project(s) with an approved Week 1 starter and an issued grant, ${cards.length} with an issued card grant`,
	)
}

await main()
