import { reconcileCsvExportRows, restoreCsvExportRows } from "../src/lib/grant-cards"

/**
 * Checks every live CSV import row against the card grants HCB holds, and brings the site in line with HCB.
 *
 * A CSV row is counted as paid the moment its file is generated, but HCB only creates the card when the file is uploaded. A row HCB never created blocks its project from being paid again, so the grant page says nothing is ready.
 *
 *   bun run grants:reconcile-csv
 *       Dry run. Prints what would change and writes nothing.
 *
 *   bun run grants:reconcile-csv -- --apply
 *       Supersedes the rows no HCB grant can be, so their projects are eligible again. Raises Funding given for confirmed Week 1 starters whose card is higher than what Airtable holds.
 *
 * Rows HCB holds a grant for stay live. Rows with a grant HCB will not show in full are reported as ambiguous and left alone.
 *
 * Output is tab-separated on stdout: verdict, project, maker email, amount, row id, reason. It holds emails, so redirect it outside the repository. The summary goes to stderr.
 */

const args = process.argv.slice(2)
const flags = new Map<string, string>()
for (let i = 0; i < args.length; i++) {
	const arg = args[i]
	if (arg === "--apply") continue
	if (arg !== "--confirm-paid" && arg !== "--supersede" && arg !== "--restore")
		throw new Error(`Unknown argument: ${arg}`)
	const value = args[i + 1]
	if (!value) throw new Error(`${arg} needs a comma-separated list of row ids`)
	flags.set(arg, value)
	i++
}
const apply = args.includes("--apply")
const restore = flags.get("--restore")
const list = (flag: string): string[] =>
	(flags.get(flag) ?? "")
		.split(",")
		.map(id => id.trim())
		.filter(Boolean)

/** Tabs and newlines would break the one-line-per-row shape. */
function oneLine(value: string): string {
	return value.replaceAll(/[\t\r\n]+/g, " ").trim()
}

if (restore !== undefined) {
	const restored = await restoreCsvExportRows(
		list("--restore"),
		"Found paid on HCB: a manual top-up on the grant, or a reissue",
	)
	console.error(`Restored ${restored} superseded row(s) to live`)
	process.exit(0)
}

const report = await reconcileCsvExportRows({
	apply,
	confirmPaid: list("--confirm-paid"),
	supersede: list("--supersede"),
})

for (const row of report.rows.toSorted(
	(a, b) => a.verdict.localeCompare(b.verdict) || a.rowId.localeCompare(b.rowId),
)) {
	const amount = `$${(row.amountCents / 100).toFixed(2)}`
	console.log([row.verdict, oneLine(row.title), oneLine(row.email), amount, row.rowId, oneLine(row.reason)].join("\t"))
}
for (const write of report.fundingWrites) {
	const outcome = write.error === null ? (apply ? "written" : "would write") : `failed: ${oneLine(write.error)}`
	console.log(
		["funding", oneLine(write.title), "", `$${write.targetUsd.toFixed(2)}`, write.recordId, outcome].join("\t"),
	)
}

const count = (kind: string): number => report.rows.filter(row => row.verdict === kind).length
console.error(
	`${report.rows.length} live row(s): ${count("landed")} confirmed by HCB, ${count("missing")} with no HCB grant, ${count("ambiguous")} ambiguous`,
)
console.error(
	`HCB listed ${report.grantsRead} card grant(s), ${report.grantsNotCanceled} not canceled (compare the latter with HCB's own count); ${report.surplusGrants} grant(s) match no CSV row`,
)
const fundingCount = report.fundingWrites.length
console.error(
	apply
		? `Applied: ${report.superseded} row(s) superseded, ${fundingCount} Funding given write(s) attempted. ${report.leftLive} missing row(s) not on the --supersede list stay live`
		: `Dry run: nothing written. Would supersede ${report.superseded} row(s) on the --supersede list, and would write ${fundingCount} Funding given value(s). ${report.leftLive} missing row(s) not on the --supersede list would stay live`,
)
