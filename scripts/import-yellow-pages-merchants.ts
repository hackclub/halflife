import "../src/lib/auth"
import { merchantSlug } from "../src/lib/grant-card-merchants"
import db from "../src/lib/prisma8"

/**
 * Create a grant card merchant for each vendor in the list below, with every Stripe network ID the Yellow Pages file gives it. The file is read from the hackclub/yellow_pages repository.
 *
 * A merchant whose slug already exists is left alone, so this is safe to run again. Its IDs are not updated: edit them on the merchants page. A dry run by default; pass `--apply` to write.
 *
 * Run with `bun --conditions=react-server scripts/import-yellow-pages-merchants.ts [--apply]`.
 */
const SOURCE = "https://raw.githubusercontent.com/hackclub/yellow_pages/main/lib/yellow_pages/merchants.yaml"

const WANTED = [
	"Amazon",
	"Walmart",
	"Target",
	"Costco Wholesale",
	"Best Buy",
	"eBay",
	"Staples",
	"Seeed Studio",
	"AliExpress",
	"Alipay",
	"Robu.in",
	"RoboCraze",
]

const apply = process.argv.includes("--apply")

/** The Yellow Pages entries with each wanted name's IDs, gathered across every record that carries the name. */
async function yellowPagesIds(): Promise<Map<string, string[]>> {
	const response = await fetch(SOURCE)
	if (!response.ok) throw new Error(`Yellow Pages returned ${response.status}`)
	const text = await response.text()
	const found = new Map<string, string[]>()
	for (const record of text.split(/\n(?=- )/)) {
		const name = record.match(/^\s*name:\s*"?([^"#\n]+?)"?\s*(#.*)?$/m)?.[1]
		if (!name || !WANTED.includes(name)) continue
		// The name is quoted on its own line too, and it is not an ID, so only the lines above it are read.
		const idLines = record
			.split("\n")
			.filter(line => !/^\s*name:/.test(line))
			.join("\n")
		const ids = [...idLines.matchAll(/"([^"]+)"/g)].map(match => match[1] ?? "")
		found.set(name, [...(found.get(name) ?? []), ...ids])
	}
	return found
}

async function main() {
	const ids = await yellowPagesIds()
	const missing = WANTED.filter(name => !ids.has(name))
	if (missing.length > 0) console.log(`not in Yellow Pages: ${missing.join(", ")}`)

	for (const [name, merchantIds] of ids) {
		const slug = merchantSlug(name)
		const existing = await db.orm.public.GrantCardMerchant.whereUnique({ slug }).select("id").first()
		if (existing) {
			console.log(`${name}: already exists, left alone`)
			continue
		}
		const unique = [...new Set(merchantIds)]
		if (!apply) {
			console.log(`${name}: ${unique.length} IDs would be created`)
			continue
		}
		await db.orm.public.GrantCardMerchant.create({
			merchantIds: unique,
			name,
			slug,
			sourceNote: `yellow_pages: ${name}`,
		})
		console.log(`${name}: created with ${unique.length} IDs`)
	}
	if (!apply) console.log("\ndry run. Pass --apply to write.")
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
} finally {
	await db.close()
}
