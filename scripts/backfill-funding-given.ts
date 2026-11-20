import { HcbGrantCardStatus, Phase } from "../src/lib/enums"
import { fundingGivenTargetUsd, paidCentsFromSources } from "../src/lib/funding-given"
import db from "../src/lib/prisma8"
import { readStarterFundingGiven, setStarterFundingGiven, starterRecordIds } from "../src/lib/starter-funding-sheet"

/**
 * Fills each project's Airtable `Funding given` from the payments the site can see.
 *
 * The field used to be written by the YSWS pipeline, so once HCB took over payouts nothing wrote it for a project that was not a Week 1 starter, and it stayed blank even though the project had been paid. This reads the site's payment records instead: cards the maker kept, live CSV import rows, top-ups sent through the site, and hand top-ups on HCB. It only ever raises a value.
 *
 *   bun run grants:backfill-funding-given
 *       Dry run. Prints what would change and writes nothing.
 *
 *   bun run grants:backfill-funding-given -- --apply
 *       Writes the values to Airtable.
 *
 * Output is tab-separated on stdout: project, title, current, target, sources, action. It holds project titles, so redirect it outside the repository. The summary goes to stderr.
 */

const args = process.argv.slice(2)
const unknown = args.filter(arg => arg !== "--apply")
if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown.join(" ")}`)
const apply = args.includes("--apply")

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`

/** Tabs and newlines would break the one-line-per-row shape. */
const oneLine = (value: string): string => value.replaceAll(/[\t\r\n]+/g, " ").trim()

/** Grant id (bare, without `cdg_`) to the project it paid, from every record that knows both. */
function grantToProject(
	cardRows: { hcbCardGrantId: string | null; themeProjectId: string }[],
	topUpRows: { grantHashid: string; themeProjectId: string }[],
): Map<string, string> {
	const byGrant = new Map<string, string>()
	for (const card of cardRows)
		if (card.hcbCardGrantId) byGrant.set(card.hcbCardGrantId.replace(/^cdg_/, ""), card.themeProjectId)
	for (const topUp of topUpRows) byGrant.set(topUp.grantHashid.replace(/^cdg_/, ""), topUp.themeProjectId)
	return byGrant
}

const cards = await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
	.select("amountCents", "hcbCardGrantId", "status", "themeProjectId")
	.all()
const topUps = await db.orm.public.HcbGrantTopUp.where(topUp => topUp.sentAt.isNotNull())
	.select("amountCents", "grantHashid", "themeProjectId")
	.all()
const exportRows = await db.orm.public.HcbCardGrantExportRow.where(row => row.supersededAt.isNull())
	.select("amountCents", "themeProjectId")
	.all()
const bufferTopUps = await db.orm.public.HcbBufferTopUp.where({}).select("amountCents", "hcbCardGrantId").all()

const sources = new Map<string, { bufferCents: number; cardCents: number; exportCents: number; topUpCents: number }>()
const add = (
	projectId: string,
	field: "bufferCents" | "cardCents" | "exportCents" | "topUpCents",
	cents: number,
): void => {
	const row = sources.get(projectId) ?? { bufferCents: 0, cardCents: 0, exportCents: 0, topUpCents: 0 }
	row[field] += cents
	sources.set(projectId, row)
}

// A card the maker kept counts. One they returned, or that was cancelled, does not: the money went back.
for (const card of cards)
	if (card.status === HcbGrantCardStatus.ISSUED || card.status === HcbGrantCardStatus.AMBIGUOUS)
		add(card.themeProjectId, "cardCents", card.amountCents)
for (const row of exportRows) add(row.themeProjectId, "exportCents", row.amountCents)
for (const topUp of topUps) add(topUp.themeProjectId, "topUpCents", topUp.amountCents)

const byGrant = grantToProject(cards, topUps)
let unmappedTopUps = 0
for (const topUp of bufferTopUps) {
	const projectId = byGrant.get(topUp.hcbCardGrantId.replace(/^cdg_/, ""))
	if (!projectId) {
		unmappedTopUps++
		continue
	}
	add(projectId, "bufferCents", topUp.amountCents)
}

const projectIds = new Set(sources.keys())
const projects = (await db.orm.public.ThemeProject.where({}).select("deletedAt", "id", "title").all()).filter(
	project => projectIds.has(project.id) && project.deletedAt === null,
)
const recordIds = await starterRecordIds(projects.map(project => project.id))
const designRecordIds = projects
	.map(project => ({ projectId: project.id, recordId: recordIds.get(`${project.id}:${Phase.DESIGN}`) }))
	.filter((row): row is { projectId: string; recordId: string } => Boolean(row.recordId))
const paid = await readStarterFundingGiven(designRecordIds.map(row => row.recordId))
if (paid === null) throw new Error("Funding given could not be read from Airtable, so nothing was written")

const lines: string[] = []
let raised = 0
let unchanged = 0
let failed = 0
for (const { projectId, recordId } of designRecordIds) {
	const project = projects.find(entry => entry.id === projectId)
	const paidRow = sources.get(projectId)
	if (!project || !paidRow) continue
	const currentUsd = paid.get(recordId) ?? 0
	const targetUsd = fundingGivenTargetUsd(currentUsd, paidCentsFromSources(paidRow))
	if (Math.abs(targetUsd - currentUsd) < 0.005) {
		unchanged++
		continue
	}
	const outcome = apply ? await setStarterFundingGiven(recordId, targetUsd) : null
	const action = apply ? (outcome === null ? "written" : `failed: ${oneLine(outcome)}`) : "would write"
	if (apply && outcome !== null) failed++
	else raised++
	const breakdown = `card ${usd(paidRow.cardCents)} / export ${usd(paidRow.exportCents)} / topup ${usd(paidRow.topUpCents)} / buffer ${usd(paidRow.bufferCents)}`
	lines.push(
		[
			projectId,
			oneLine(project.title),
			usd(Math.round(currentUsd * 100)),
			usd(Math.round(targetUsd * 100)),
			breakdown,
			action,
		].join("\t"),
	)
}

lines.sort()
for (const line of lines) console.log(line)
console.error(
	`${designRecordIds.length} paid project(s) with a design row; ${raised} ${apply ? "written" : "would be raised"}, ${unchanged} already correct, ${failed} failed`,
)
if (unmappedTopUps > 0)
	console.error(`${unmappedTopUps} hand top-up(s) on a grant no project record names, so they were left out`)
console.error(apply ? "Applied." : "Dry run: nothing written. Re-run with --apply to write.")

await db.close()
