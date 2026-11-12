import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { configuredOrigin } from "../src/lib/origin"
import db from "../src/lib/prisma8"
import { kitShippingTsv, type StarterCardRow, starterCardCsv } from "../src/lib/starter-funding-csv"
import { type StarterFundingDecision, starterFundingDecisions } from "../src/lib/starter-funding-export"

/**
 * The Week 1 starter export: the HCB card CSV for every starter still owed, and the kit list for everyone sent a kit.
 *
 *   bun run grants:starter-export -- --kits ./starter-kits.tsv --report ./starter-report.tsv > ./starter-cards.csv
 *
 * Read-only against the database and Airtable. The CSV goes to stdout, so it can be redirected. The kit list and the report hold addresses and emails, so they must be written outside this repository or to a path git ignores (see .gitignore). The run refuses if the payout source is not HCB, if Airtable's country and the verified address disagree, or if a kit is needed and no `--kits` file was given.
 */

interface Args {
	kits: string | null
	report: string | null
}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = { kits: null, report: null }
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]
		if (flag !== "--kits" && flag !== "--report") throw new Error(`Unknown argument: ${flag}`)
		const value = argv[i + 1]
		if (!value) throw new Error(`${flag} needs a path`)
		if (flag === "--kits") args.kits = value
		else args.report = value
		i++
	}
	return args
}

/**
 * Files that hold addresses must never be committed. A path outside the repository is always fine; a path inside it is fine only when git ignores it, so it cannot be added by accident.
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

function cardRows(decisions: readonly StarterFundingDecision[]): StarterCardRow[] {
	const rows: StarterCardRow[] = []
	for (const decision of decisions) {
		if (decision.owedUsd <= 0) continue
		if (decision.fulfilment !== "KIT_WITH_PCB_CARD" && decision.fulfilment !== "PARTS_CARD") continue
		rows.push({
			amountCents: Math.round(decision.owedUsd * 100),
			email: decision.email,
			fulfilment: decision.fulfilment,
			projectId: decision.projectId,
			title: decision.title,
		})
	}
	return rows
}

function reportTsv(decisions: readonly StarterFundingDecision[]): string {
	const header = ["name", "email", "fulfilment", "card usd", "owed usd", "reason", "airtable record", "project"]
	const lines = [header.join("\t")]
	for (const d of decisions)
		lines.push(
			[d.name, d.email, d.fulfilment, d.cardUsd, d.owedUsd, d.reason, d.airtableRecordId ?? "", d.projectId]
				.map(v => String(v).replaceAll(/[\t\r\n]+/g, " "))
				.join("\t"),
		)
	return `${lines.join("\n")}\n`
}

function count(decisions: readonly StarterFundingDecision[], fulfilment: StarterFundingDecision["fulfilment"]): number {
	return decisions.filter(d => d.fulfilment === fulfilment).length
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	const kitsPath = args.kits ? safeOutputPath(args.kits) : null
	const reportPath = args.report ? safeOutputPath(args.report) : null

	const decisions = await starterFundingDecisions(new Date())
	const kitRows = decisions.filter(d => d.fulfilment === "KIT_WITH_PCB_CARD" || d.fulfilment === "KIT_ONLY")
	if (kitRows.length > 0 && !kitsPath)
		throw new Error(`${kitRows.length} kit(s) to ship: pass --kits <file outside the repo>`)

	const shipRows = kitRows.flatMap(d => (d.address ? [d.address] : []))
	const missingAddress = kitRows.length - shipRows.length
	if (missingAddress > 0) throw new Error(`${missingAddress} kit(s) have no verified address; they cannot be shipped`)

	const origin = configuredOrigin()
	if (!origin)
		console.error("NEXT_PUBLIC_APP_URL and BETTER_AUTH_URL are unset, so instructions will have no project link")

	const cards = cardRows(decisions)
	process.stdout.write(starterCardCsv(cards, origin))
	if (kitsPath) writeFileSync(kitsPath, kitShippingTsv(shipRows), { mode: 0o600 })
	if (reportPath) writeFileSync(reportPath, reportTsv(decisions), { mode: 0o600 })

	const flagged = decisions.filter(d => d.fulfilment === "FLAG" || d.fulfilment === "HOLD")
	console.error(
		`${decisions.length} starter(s): ${count(decisions, "KIT_WITH_PCB_CARD")} kit + PCB card, ${count(decisions, "KIT_ONLY")} kit only, ${count(decisions, "PARTS_CARD")} parts card, ${count(decisions, "WAIT")} waiting, ${count(decisions, "NONE")} nothing owed, ${count(decisions, "HOLD")} held, ${flagged.length} flagged. ${cards.length} card(s) written.`,
	)
	if (!reportPath) console.error("Pass --report <file outside the repo> to list every row and its reason.")
}

try {
	await main()
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
} finally {
	await db.close()
}
