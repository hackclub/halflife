import "../src/lib/auth"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve, sep } from "node:path"
import { configuredOrigin } from "../src/lib/origin"
import db from "../src/lib/prisma8"
import { liveRowIdsByProject, recordStarterCards, supersedeLiveCards } from "../src/lib/starter-card-records"
import { parseConfirmedTotals, refusedTotal } from "../src/lib/starter-funding-confirm"
import { type StarterCardRow, starterCardCsv } from "../src/lib/starter-funding-csv"
import { type StarterFundingDecision, starterFundingDecisions } from "../src/lib/starter-funding-export"

/**
 * The Week 1 starter export, in three modes.
 *
 *   bun run grants:starter-export -- --report ./starter-report.tsv > ./starter-new-cards.csv
 *       The HCB import file for every starter who needs a new parts + PCB card, and a checklist of every starter's target and top-up. Read-only.
 *
 *   bun run grants:starter-export -- --record
 *       Records the new cards on the site, so a later run skips them. Only new cards are recorded.
 *
 *   bun run grants:starter-export -- --confirm ./confirmed-totals.csv [--apply]
 *       Records the card totals an admin confirmed on HCB after a top-up. Each row supersedes the live card and records the new total. Dry run unless --apply is passed. Any row that would reduce a card, go above the target, or fall below Funding given refuses the whole file, and nothing is written.
 *
 * Top-ups are not in the import file: a maker with a live card is topped up by hand in HCB. Airtable's `Funding given` is set through the approval step, not by this script. The report and the confirmed totals hold emails, so they must be written outside this repository or to a path git ignores (see .gitignore).
 */

interface Args {
	apply: boolean
	confirm: string | null
	record: boolean
	report: string | null
}

function parseArgs(argv: readonly string[]): Args {
	const args: Args = { apply: false, confirm: null, record: false, report: null }
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i]
		if (flag === "--record") {
			args.record = true
			continue
		}
		if (flag === "--apply") {
			args.apply = true
			continue
		}
		if (flag !== "--report" && flag !== "--confirm") throw new Error(`Unknown argument: ${flag}`)
		const value = argv[i + 1]
		if (!value) throw new Error(`${flag} needs a path`)
		if (flag === "--report") args.report = value
		else args.confirm = value
		i++
	}
	if (args.apply && !args.confirm) throw new Error("--apply only applies with --confirm")
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
				.map(v => v.replaceAll(/[\t\r\n]+/g, " "))
				.join("\t"),
		)
	return `${lines.join("\n")}\n`
}

function count(decisions: readonly StarterFundingDecision[], action: StarterFundingDecision["action"]): number {
	return decisions.filter(d => d.action === action).length
}

async function exportMode(args: Args): Promise<void> {
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

/** Checks every confirmed row against the site and Airtable. Refuses the whole file on any problem, and records nothing unless `--apply` is passed. */
async function confirmMode(args: Args, path: string): Promise<void> {
	const { problems, rows } = parseConfirmedTotals(readFileSync(resolve(path), "utf8"))
	if (problems.length > 0) throw new Error(`The confirmed totals file has problems: ${problems.join("; ")}`)

	const decisions = await starterFundingDecisions()
	const byProject = new Map(decisions.map(decision => [decision.projectId, decision]))
	const refusals: string[] = []
	const plan: { airtableRecordId: string | null; email: string; projectId: string; totalCents: number }[] = []
	for (const row of rows) {
		const decision = byProject.get(row.projectId)
		if (!decision) {
			refusals.push(`${row.email}: no approved Week 1 starter for project ${row.projectId}`)
			continue
		}
		// A starter who is already at target (Funding given already matches the card) is still a valid confirmation: it records the card the site is missing. Only a new card, a held or flagged starter, or one with no target is refused.
		if (
			decision.action === "NEW_CARD"
			|| decision.cardUsd <= 0
			|| decision.fulfilment === "HOLD"
			|| decision.fulfilment === "FLAG"
		) {
			refusals.push(`${row.email}: not a card to confirm (the export says ${decision.action ?? decision.fulfilment})`)
			continue
		}
		const reason = refusedTotal(row, {
			email: decision.email,
			fundingGivenCents: Math.round(decision.fundingGivenUsd * 100),
			recordedCents: decision.recordedCardUsd === null ? null : Math.round(decision.recordedCardUsd * 100),
			targetCents: Math.round(decision.cardUsd * 100),
		})
		if (reason) refusals.push(`${row.email}: ${reason}`)
		else
			plan.push({
				airtableRecordId: decision.airtableRecordId,
				email: row.email,
				projectId: row.projectId,
				totalCents: row.totalCents,
			})
	}
	if (refusals.length > 0) throw new Error(`Refused, nothing written:\n  ${refusals.join("\n  ")}`)

	for (const entry of plan)
		console.error(
			`${entry.email}\t${(entry.totalCents / 100).toFixed(2)}\tairtable ${entry.airtableRecordId ?? "(none)"}`,
		)
	console.error(
		`${plan.length} top-up(s) to record, $${(plan.reduce((sum, entry) => sum + entry.totalCents, 0) / 100).toFixed(2)} in total.`,
	)
	if (!args.apply) {
		console.error("Dry run. Pass --apply to record them. Airtable's Funding given is set separately, through approval.")
		return
	}

	const liveRows = await liveRowIdsByProject(plan.map(entry => entry.projectId))
	for (const entry of plan) {
		const superseded = liveRows.get(entry.projectId) ?? []
		if (superseded.length > 0)
			await supersedeLiveCards(superseded, "topped up by hand in HCB; superseded so the new total can be recorded")
		await recordStarterCards([{ amountCents: entry.totalCents, email: entry.email, projectId: entry.projectId }])
		console.error(`Recorded ${entry.email}: $${(entry.totalCents / 100).toFixed(2)}`)
	}
	console.error("Now set Funding given in Airtable to each total above, through the approval step.")
}

function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2))
	if (args.confirm) return confirmMode(args, args.confirm)
	return exportMode(args)
}

try {
	await main()
} catch (err) {
	console.error(err instanceof Error ? err.message : err)
	process.exitCode = 1
} finally {
	await db.close()
}
