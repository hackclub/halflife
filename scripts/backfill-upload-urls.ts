import "dotenv/config"
import prisma from "../src/lib/prisma"
import { objectExists } from "../src/lib/uploads/r2"

/**
 * Repoint stored journal image URLs at the object that actually exists.
 *
 * Journals are the only place this app stores a minted URL rather than an object key: the picture sits inside the Markdown, so the link is copied into `work_session.content` and stays there. Covers, reels and submission attachments store keys and mint their URL at read time, so they heal on their own – a stored URL does not.
 *
 * A blind rewrite is wrong here, which is why this asks the bucket. Two key layouts are in circulation:
 *
 * - Objects written while the S3 endpoint still carried the bucket name landed at `<bucket>/<key>`, and their public URL is `<origin>/<bucket>/<key>`.
 * - Objects written after that was fixed land at `<key>`, and their public URL is `<origin>/<key>`.
 *
 * Both URLs are correct for their own object, so a row may hold either and only the bucket can say which one is real. For each URL on the public origin, this checks the key it names; if that object is missing, it checks the other layout and repoints the URL when the bytes are there. A URL whose object is in neither place is reported and left alone, because a guess would only trade one broken image for another.
 *
 * Only `work_session.content` is touched. The other text columns are plain text, not Markdown, and every other upload reference in the schema is a key.
 *
 * Read-only unless `--commit` is passed. Safe to run again: a row with every URL already correct changes nothing.
 *
 * Run `pnpm verify:uploads` first, so the base is known to serve the bucket. Then:
 * `pnpm uploads:backfill-urls` (dry run), and `pnpm uploads:backfill-urls -- --commit` to write.
 *
 * A project that mirrors into GitHub keeps the old links in `JOURNAL.md` until that project's next sync; the projects this run changed are listed at the end.
 */

const commit = process.argv.includes("--commit")

/** The public origin every stored asset URL starts with, and the bucket its keys live in. */
function publicBase(): { bucket: string; origin: string } | null {
	const origin = (process.env.S3_PUBLIC_URL ?? "").replace(/\/+$/, "")
	const bucket = process.env.S3_BUCKET_NAME ?? ""
	if (!origin || !bucket) {
		console.error("Set S3_PUBLIC_URL and S3_BUCKET_NAME first")
		return null
	}
	try {
		const lastSegment = new URL(origin).pathname.replace(/\/+$/, "").split("/").pop()
		if (lastSegment === bucket) {
			console.error(
				`S3_PUBLIC_URL still ends in /${bucket}. New uploads need it to be the origin alone – run \`pnpm verify:uploads\`, then run this again.`,
			)
			return null
		}
	} catch {
		console.error("S3_PUBLIC_URL is not a URL; check for a missing https://")
		return null
	}
	return { bucket, origin }
}

function escapeRegExp(text: string): string {
	return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}

/** Every absolute URL on the public origin in one entry, each once. */
function assetUrls(content: string, origin: string): string[] {
	const pattern = new RegExp(`${escapeRegExp(origin)}/[^\\s)"'<>\\]]+`, "g")
	return [...new Set(content.match(pattern))]
}

interface Resolution {
	state: "moved" | "missing" | "ok"
	url: string
}

/**
 * Where this key actually is.
 *
 * The stored key is checked first, so an entry that already points at its object is never touched. Only when it is missing is the other layout tried, and only a hit there makes a rewrite.
 */
async function resolve(url: string, origin: string, bucket: string): Promise<Resolution> {
	const key = url.slice(origin.length + 1)
	if (await objectExists(key)) return { state: "ok", url }

	const other = key.startsWith(`${bucket}/`) ? key.slice(bucket.length + 1) : `${bucket}/${key}`
	if (await objectExists(other)) return { state: "moved", url: `${origin}/${other}` }

	return { state: "missing", url }
}

function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`
}

async function main() {
	const base = publicBase()
	if (!base) {
		process.exitCode = 1
		return
	}

	const rows = await prisma.workSession.findMany({
		orderBy: { createdAt: "asc" },
		select: {
			content: true,
			id: true,
			themeProject: { select: { id: true, repoSyncEnabled: true, title: true } },
		},
		where: { content: { contains: base.origin } },
	})
	// One HEAD per unique key, not per mention: a picture used in two entries is one object.
	const resolved = new Map<string, Resolution>()
	const plan: { content: string; id: string; project: { id: string; repoSyncEnabled: boolean; title: string } }[] = []

	for (const row of rows) {
		const content = row.content ?? ""
		let next = content
		for (const url of assetUrls(content, base.origin)) {
			let outcome = resolved.get(url)
			if (!outcome) {
				outcome = await resolve(url, base.origin, base.bucket)
				resolved.set(url, outcome)
			}
			if (outcome.state === "moved") next = next.replaceAll(url, outcome.url)
		}
		if (next !== content) plan.push({ content: next, id: row.id, project: row.themeProject })
	}

	const counts = { missing: 0, moved: 0, ok: 0 }
	const missing: string[] = []
	for (const [url, outcome] of resolved) {
		counts[outcome.state] += 1
		if (outcome.state === "missing") missing.push(url)
	}

	if (plan.length === 0) {
		console.log(
			`no journal URL needs moving: ${counts.ok} correct, ${counts.missing ? `${counts.missing} missing from the bucket` : "none missing"}`,
		)
		if (missing.length > 0) printMissing(missing)
		return
	}

	console.log(
		`${plural(counts.moved, "image URL")} will be repointed to where its object actually is; ${counts.ok} already correct, ${counts.missing} missing at both layouts`,
	)
	for (const [from, to] of [...resolved]
		.flatMap(([url, outcome]) => (outcome.state === "moved" ? [[url, outcome.url]] : []))
		.slice(0, 3))
		console.log(`  ${from}\n    → ${to}`)
	for (const row of plan.slice(0, 5)) console.log(`  journal entry ${row.id} in "${row.project.title || "(untitled)"}"`)
	if (plan.length > 5) console.log(`  and ${plan.length - 5} more`)

	if (missing.length > 0) printMissing(missing)

	if (!commit) {
		console.log("\ndry run; pass --commit to write")
		return
	}

	let written = 0
	for (const row of plan) {
		await prisma.workSession.update({ data: { content: row.content }, where: { id: row.id } })
		written += 1
	}
	console.log(`updated ${plural(written, "journal entry", "journal entries")}`)

	const projects = new Map<string, { repoSyncEnabled: boolean; title: string }>()
	for (const row of plan) projects.set(row.project.id, row.project)
	const mirrored = [...projects.values()].filter(project => project.repoSyncEnabled)
	if (mirrored.length > 0) {
		console.warn(
			`${plural(mirrored.length, "mirrored project")} keeps its old links in JOURNAL.md until its next sync:`,
		)
		for (const project of mirrored.slice(0, 20))
			console.warn(`  ${project.title || "(untitled)"} – sync it from the project page, or wait for the next edit`)
		if (mirrored.length > 20) console.warn(`  and ${mirrored.length - 20} more`)
	}
}

function printMissing(urls: string[]) {
	console.warn(
		`${urls.length === 1 ? "1 URL has" : `${urls.length} URLs have`} no object at either key layout; left as written:`,
	)
	for (const url of urls.slice(0, 10)) console.warn(`  ${url}`)
	if (urls.length > 10) console.warn(`  and ${urls.length - 10} more`)
}

main()
	.catch(err => {
		console.error(err)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
