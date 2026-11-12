import "../src/lib/auth"
import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { configuredOrigin } from "../src/lib/origin"
import db from "../src/lib/prisma8"
import { recordStarterCards } from "../src/lib/starter-card-records"
import { type StarterCardRow, starterCardCsv } from "../src/lib/starter-funding-csv"
import { type StarterFundingDecision, starterFundingDecisions } from "../src/lib/starter-funding-export"

/**
 * The Week 1 starter export: the HCB import file for every starter who needs a new parts + PCB card, and a checklist of every starter's target and top-up.
 *
 *   bun run grants:starter-export -- --report ./starter-report.tsv > ./starter-new-cards.csv
 *
 * Read-only against the database and Airtable, unless `--record` is passed, which records the new cards on the site. The import file goes to stdout, so it can be redirected. The report holds emails and must be written outside this repository or to a path git ignores (see .gitignore).
 *
 * Top-ups are not in the import file. A maker with a live card is topped up by hand in HCB, and the checklist shows the amount.
 */

interface Args {
	record: boolean
	report: string | null
}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = { record: false, report: null }
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]
		if (flag === "--record") {
			args.record = true
			continue
		}
		if (flag !== "--report") throw new Error(`Unknown argument: ${flag}`)
		const value = argv[i + 1]
		if (!value) throw new Error("--report needs a path")
		args.report = value
		i++
	}
	return args
}

/**
 * Files that hold emails must never be committed. A path outside the repository is always fine; a path inside it is fine only when git ignores it, so it cannot be added by accident.
 */
function safeOutputPath(path: string): string {
	const absolute = resolve(path)
	const root = resolve(process.cwd())
	const inside = absolute === root || absolute.startsWith(`${root}${sep}`)
	if (!inside) return absolute
	const ignored = spawnSync("git", ["check-ignore", "-q", "--", absolute], { cwd: root }).status === 0
	if (!ignored)
		throw new Error(
			`${path} is inside the repository and not gitignored. Add it to .gitignore or write it outside the repo.`,
		)
	return absolute
}

function newCards(decisions: readonly StarterFundingDecision[]): StarterCardRow[] {
	return decisions
		.filter(decision => decision.action === "NEW_CARD")
		.map(decision => ({
			amountCents: Math.round(decision.owedUsd * 100),
			email: decision.email,
			projectId: decision.projectId,
			title: decision.title,
		}))
}

function reportTsv(decisions: readonly StarterFundingDecision[]): string {
	const header = [
		"name",
		"email",
		"action",
		"bom usd",
		"target usd",
		"funding given usd",
		"recorded card usd",
		"owed usd",
		"reason",
		"airtable record",
		"project",
	]
	const lines = [header.join("\t")]
	for (const d of decisions)
		lines.push(
			[
				d.name,
				d.email,
				d.action ?? "-",
				d.bomTotalUsd.toFixed(2),
				d.cardUsd.toFixed(2),
				d.fundingGivenUsd.toFixed(2),
				d.recordedCardUsd === null ? "-" : d.recordedCardUsd.toFixed(2),
				d.owedUsd.toFixed(2),
				d.reason,
				d.airtableRecordId ?? "",
				d.projectId,
			]
				.map(v => String(v).replaceAll(/[\t\r\n]+/g, " "))
				.join("\t"),
		)
	return `${lines.join("\n")}\n`
}

function count(decisions: readonly StarterFundingDecision[], action: StarterFundingDecision["action"]): number {
	return decisions.filter(d => d.action === action).length
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	const reportPath = args.report ? safeOutputPath(args.report) : null

	const decisions = await starterFundingDecisions()
	const cards = newCards(decisions)
	const origin = configuredOrigin()
	if (!origin)
		console.error("NEXT_PUBLIC_APP_URL and BETTER_AUTH_URL are unset, so instructions will have no project link")

	// Recorded before any file is written: a project that already has a live card refuses the whole batch, so no CSV goes out for it.
	if (args.record && cards.length > 0) {
		const { batchId, totalCents } = await recordStarterCards(
			cards.map(card => ({ amountCents: card.amountCents, email: card.email, projectId: card.projectId })),
		)
		console.error(`Recorded ${cards.length} new card(s), $${(totalCents / 100).toFixed(2)}, as batch ${batchId}.`)
	} else if (cards.length > 0) console.error("New cards are not recorded on the site. Pass --record to record them.")
	process.stdout.write(starterCardCsv(cards, origin))
	if (reportPath) writeFileSync(reportPath, reportTsv(decisions), { mode: 0o600 })

	const flagged = decisions.filter(d => d.fulfilment === "FLAG")
	const held = decisions.filter(d => d.fulfilment === "HOLD")
	console.error(
		`${decisions.length} starter(s): ${count(decisions, "NEW_CARD")} new card(s), ${count(decisions, "TOP_UP")} top-up(s), ${decisions.filter(d => d.action === null).length} nothing owed, ${held.length} held, ${flagged.length} flagged.`,
	)
	if (!reportPath) console.error("Pass --report <file outside the repo> to list every row and its amounts.")
}

try {
	await main()
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
} finally {
	await db.close()
}
