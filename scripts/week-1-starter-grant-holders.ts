import { not } from "@prisma/orm-postgres/orm-client"
import { starterProjectsFor } from "../src/lib/config/onboarding"
import { displayName } from "../src/lib/display-name"
import { PhaseStatus, Theme } from "../src/lib/enums"
import db from "../src/lib/prisma8"

/**
 * Every maker whose Week 1 starter project was approved and had a grant issued for it, one line per maker: name, then email.
 *
 * Week 1 is the PCB week, and its only starter is Starbie (see `lib/config/onboarding`). A starter counts when:
 *
 * - it was taken (`starterProjectId` is one of Week 1's starters) and not deleted;
 * - its design was approved, since the grant is emitted by the design approval;
 * - a grant was issued for it: `grantEmittedAt` is set and `grantUsd` is above zero.
 *
 * A maker with more than one qualifying project is listed once. Read-only, and safe to run against production:
 *
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts
 *   bun --conditions=react-server scripts/week-1-starter-grant-holders.ts > week-1-grant-holders.tsv
 *
 * The count goes to stderr so a redirected file holds only the rows.
 */

/** Tabs and newlines would break the one-line-per-maker shape. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

async function main(): Promise<void> {
	const starterIds = starterProjectsFor(Theme.PCB).map(starter => starter.id)

	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null, designStatus: PhaseStatus.approved })
		.where(project => project.starterProjectId.in(starterIds))
		.where(project => not(project.grantEmittedAt.isNull()))
		.where(project => project.grantUsd.gt(0))
		.select("id", "starterProjectId", "userId")
		.include("user", user => user.select("displayName", "email", "name"))
		.all()

	const makers = new Map<string, { email: string; name: string }>()
	for (const project of projects) {
		if (!project.user || makers.has(project.userId)) continue
		makers.set(project.userId, {
			email: project.user.email,
			name: displayName(project.user, "(no name)"),
		})
	}

	const rows = [...makers.values()].toSorted((a, b) => a.name.localeCompare(b.name))
	for (const row of rows) console.log(`${oneLine(row.name)}\t${oneLine(row.email)}`)

	console.error(
		`${rows.length} maker(s) with an approved Week 1 starter and an issued grant (${projects.length} project(s))`,
	)
}

await main()
