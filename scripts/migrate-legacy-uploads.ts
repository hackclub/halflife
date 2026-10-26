import { createHash, createHmac } from "node:crypto"
import { S3Client } from "bun"

/**
 * Move objects written under a doubled bucket prefix to the keys the app stores.
 *
 * Before the S3 endpoint lost its bucket segment, every upload landed at `<bucket>/<key>` while the app recorded `<key>`. New uploads are correct, but the rows and Markdown written before then still name the root key, so their public URL 404s. This copies each legacy object to its root key, server-side, leaving the object bytes in R2 and nothing to change in Postgres.
 *
 * Does not delete the legacy copy unless `--delete-legacy` is passed. That is best run after `uploads:backfill-urls` has repointed any journal URL that names the legacy layout, and after mirrored projects have synced their `JOURNAL.md`, which keeps the old links until its next sync. A dry run lists what would move and writes nothing.
 *
 * Run against the live bucket with production credentials: `bun scripts/migrate-legacy-uploads.ts` (dry run) `bun scripts/migrate-legacy-uploads.ts --commit` `bun scripts/migrate-legacy-uploads.ts --commit --delete-legacy`
 *
 * Narrow a run with `--prefix=covers/`, cap it with `--limit=10`, and tune the copy parallelism with `--concurrency=16`.
 */

interface Args {
	commit: boolean
	concurrency: number
	deleteLegacy: boolean
	limit: number | null
	prefix: string
}

interface BucketObject {
	key: string
	size: number
}

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex")
const RETRIES = 4

function parseArgs(): Args {
	const value = (name: string): string | null => {
		const arg = process.argv.find(entry => entry.startsWith(`--${name}=`))
		return arg ? arg.slice(name.length + 3) : null
	}
	const number = (name: string, fallback: number): number => {
		const raw = value(name)
		const parsed = raw === null ? Number.NaN : Number(raw)
		return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
	}
	const limit = value("limit")
	return {
		commit: process.argv.includes("--commit"),
		concurrency: Math.min(Math.max(number("concurrency", 16), 1), 64),
		deleteLegacy: process.argv.includes("--delete-legacy"),
		limit: limit === null ? null : number("limit", 0) || null,
		prefix: value("prefix") ?? "",
	}
}

/** The endpoint without the bucket segment the old configuration carried. */
function endpointRoot(): string {
	const raw = process.env.S3_ENDPOINT ?? ""
	const bucket = process.env.S3_BUCKET_NAME ?? ""
	if (!raw || !bucket) throw new Error("Set S3_ENDPOINT and S3_BUCKET_NAME first")
	const url = new URL(raw)
	if (url.pathname.replaceAll(/^\/+|\/+$/g, "") === bucket) url.pathname = url.pathname.replace(/\/[^/]+\/?$/, "")
	return url.toString().replace(/\/$/, "")
}

function client(endpoint: string): S3Client {
	return new S3Client({
		accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
		bucket: process.env.S3_BUCKET_NAME ?? "",
		endpoint,
		region: "auto",
		secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
	})
}

async function listObjects(s3: S3Client, prefix: string): Promise<BucketObject[]> {
	const objects: BucketObject[] = []
	let cursor: string | undefined
	do {
		const page = await s3.list({ continuationToken: cursor, maxKeys: 1000, prefix: prefix || undefined })
		for (const object of page.contents ?? []) if (object.key) objects.push({ key: object.key, size: object.size ?? 0 })
		cursor = page.isTruncated ? (page.nextContinuationToken ?? undefined) : undefined
	} while (cursor)
	return objects
}

/** Percent-encode one ASCII character that `encodeURIComponent` leaves alone. */
function percentEncode(char: string): string {
	const code = char.codePointAt(0)
	if (code === undefined) return char
	return `%${code.toString(16).toUpperCase()}`
}

/** RFC 3986 encoding, per path segment, which is what SigV4 canonicalises. */
function encodeKey(key: string): string {
	return key
		.split("/")
		.map(segment => encodeURIComponent(segment).replaceAll(/[!'()*]/g, percentEncode))
		.join("/")
}

async function copyObject(endpoint: string, bucket: string, source: string, destination: string): Promise<void> {
	const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? ""
	const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? ""
	if (!accessKeyId || !secretAccessKey) throw new Error("Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY first")

	const { host } = new URL(endpoint)
	const destinationPath = `/${bucket}/${encodeKey(destination)}`
	const copySource = `/${bucket}/${encodeKey(source)}`
	const now = new Date()
	const amzDate = now.toISOString().replaceAll(/[:-]|\.\d{3}/g, "")
	const dateStamp = amzDate.slice(0, 8)

	const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${EMPTY_SHA256}\nx-amz-copy-source:${copySource}\nx-amz-date:${amzDate}\n`
	const signedHeaders = "host;x-amz-content-sha256;x-amz-copy-source;x-amz-date"
	const canonicalRequest = `PUT\n${destinationPath}\n\n${canonicalHeaders}\n${signedHeaders}\n${EMPTY_SHA256}`
	const scope = `${dateStamp}/auto/s3/aws4_request`
	const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${createHash("sha256").update(canonicalRequest).digest("hex")}`
	const key = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest()
	const regionKey = createHmac("sha256", key).update("auto").digest()
	const serviceKey = createHmac("sha256", regionKey).update("s3").digest()
	const signingKey = createHmac("sha256", serviceKey).update("aws4_request").digest()
	const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex")
	const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

	for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
		try {
			const response = await fetch(`${endpoint}${destinationPath}`, {
				headers: {
					authorization,
					"x-amz-content-sha256": EMPTY_SHA256,
					"x-amz-copy-source": copySource,
					"x-amz-date": amzDate,
				},
				method: "PUT",
			})
			if (response.ok) return
			const detail = (await response.text()).slice(0, 500)
			// A 5xx or a throttle is worth another go; a 403 or 404 will not change.
			if (response.status < 500 && response.status !== 429)
				throw new Error(`${response.status} ${response.statusText}: ${detail}`)
			if (attempt === RETRIES) throw new Error(`${response.status} ${response.statusText}: ${detail}`)
		} catch (err) {
			if (attempt === RETRIES) throw err
		}
		await new Promise(resolve => setTimeout(resolve, 250 * 2 ** (attempt - 1)))
	}
}

async function runPool<T>(
	items: T[],
	concurrency: number,
	worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
	let next = 0
	async function drain(): Promise<void> {
		while (next < items.length) {
			const index = next
			const item = items[index]
			next += 1
			if (item === undefined) continue
			await worker(item, index)
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, drain))
}

function plural(count: number, one: string, many = `${one}s`): string {
	return `${count} ${count === 1 ? one : many}`
}

function gib(bytes: number): string {
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

async function main() {
	const args = parseArgs()
	if (args.deleteLegacy && !args.commit) throw new Error("--delete-legacy writes, so it also needs --commit")

	const bucket = process.env.S3_BUCKET_NAME ?? ""
	if (!bucket) throw new Error("Set S3_BUCKET_NAME first")
	const endpoint = endpointRoot()
	const s3 = client(endpoint)

	console.log(`Bucket ${bucket}; listing objects…`)
	const all = await listObjects(s3, "")
	const existing = new Set(all.map(object => object.key))
	const legacyPrefix = args.prefix ? `${bucket}/${args.prefix}` : `${bucket}/`
	const legacy = all.filter(object => object.key.startsWith(legacyPrefix) && object.key.length > legacyPrefix.length)
	const toMove = legacy.flatMap(object => {
		const destination = object.key.slice(bucket.length + 1)
		const conflict = existing.has(destination)
		return conflict ? [] : [{ destination, size: object.size, source: object.key }]
	})
	const conflicts = legacy.filter(object => existing.has(object.key.slice(bucket.length + 1)))
	const conflictsBytes = conflicts.reduce((sum, object) => sum + object.size, 0)
	const selected = args.limit === null ? toMove : toMove.slice(0, args.limit)

	console.log(
		`legacy objects: ${plural(legacy.length, "object")} (${gib(legacy.reduce((sum, object) => sum + object.size, 0))})`,
	)
	console.log(`already at the root: ${plural(conflicts.length, "object")} (${gib(conflictsBytes)}) – left alone`)
	console.log(
		`to copy: ${plural(selected.length, "object")} (${gib(selected.reduce((sum, object) => sum + object.size, 0))})`,
	)
	if (args.limit !== null && toMove.length > selected.length) console.log(`limited to the first ${selected.length}`)
	if (args.prefix) console.log(`prefix: ${args.prefix}`)
	for (const object of selected.slice(0, 5)) console.log(`  ${object.source}\n    → ${object.destination}`)
	if (selected.length > 5) console.log(`  and ${selected.length - 5} more`)

	if (!args.commit) {
		console.log("\nDry run. Pass --commit to copy them to their root keys.")
		if (args.deleteLegacy) console.log("--delete-legacy would then remove the legacy copies.")
		return
	}

	let copied = 0
	let deleted = 0
	let failed = 0
	await runPool(selected, args.concurrency, async object => {
		try {
			await copyObject(endpoint, bucket, object.source, object.destination)
			copied += 1
			if (args.deleteLegacy) {
				const moved = await s3.stat(object.destination)
				if (moved.size !== object.size) throw new Error(`copied size ${moved.size} does not match ${object.size}`)
				await s3.delete(object.source)
				deleted += 1
			}
			if (copied % 100 === 0) console.log(`copied ${copied}/${selected.length}…`)
		} catch (err) {
			failed += 1
			console.error(`  failed ${object.source}:`, err instanceof Error ? err.message : err)
		}
	})

	console.log(`\ncopied ${copied}, deleted ${deleted}, failed ${failed}`)
	if (failed > 0) process.exitCode = 1
	if (args.deleteLegacy && deleted > 0 && conflicts.length > 0)
		console.log(
			`${plural(conflicts.length, "legacy object")} already had a root twin and were left in place; remove them by hand if they are not needed.`,
		)
	if (copied > 0) console.log("Run `uploads:backfill-urls` to repoint journal URLs that still name the legacy layout.")
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
}
