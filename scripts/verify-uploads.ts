/**
 * Smoke-test the R2 wiring, end to end, with no database involved.
 *
 * Uploads a small object through the same code path `/api/upload` uses, mints its public URL the way the feed does, fetches that URL over the open internet, compares the bytes, and deletes it again.
 *
 * The fetch is the point. Credentials that can write and a bucket the browser can read are two different things: a deployment can upload every reel successfully and play none of them, and nothing in the app would say so – `publicUrlFor` just returns a URL that 403s (the bucket is not public) or 404s (the public base points at a path the host does not serve). This catches both before there is a feed sitting on top of it.
 *
 * Prints no secret values, only whether each is present.
 *
 * Run with `pnpm verify:uploads`.
 */

let failures = 0
function check(label: string, ok: boolean, detail = "") {
	if (!ok) failures++
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `: ${detail}` : ""}`)
}

/** A 1x1 transparent PNG. Small enough to be free, real enough to be a file. */
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

/**
 * Why the public URL refused an object the PUT just stored, in terms an operator can act on.
 *
 * A 403 is the bucket's access policy. A 404 is not the same fault: the bytes were written, so the URL is pointing at the wrong place – most often a bucket segment in `S3_PUBLIC_URL` on a custom domain that already serves the bucket at its root. Proving that with the bare origin is worth one extra request, because the alternative is sending someone to the R2 dashboard over a broken picture.
 */
async function unreadableReason(res: Response, url: string, key: string, body: Buffer): Promise<string> {
	const status = `${res.status} ${res.statusText}`
	if (res.status === 401 || res.status === 403)
		return `${status}. The bucket is not public: enable the r2.dev subdomain or attach a custom domain, or reels will upload fine and never play.`

	if (res.status === 404) {
		const bare = new URL(url)
		bare.pathname = `/${key}`
		if (bare.toString() !== url)
			try {
				const probe = await fetch(bare, { cache: "no-store" })
				if (probe.ok && Buffer.from(await probe.arrayBuffer()).equals(body))
					return `${status} at ${url}, but the same object is readable at ${bare}. S3_PUBLIC_URL carries a path prefix the bucket does not serve – set it to that origin alone.`
			} catch {
				// Best-effort; the 404 below stands either way.
			}
		return `${status} at ${url}. The PUT succeeded, so the object exists – check that S3_PUBLIC_URL is the origin the bucket is actually served from, path included.`
	}

	return `${status} at ${url}.`
}

async function main() {
	const { isUploadConfigured, putObject, presignUpload, publicUrlFor, deleteObject, MAX_UPLOAD_BYTES } = await import(
		"../src/lib/uploads/r2"
	)

	// ── Configuration ──────────────────────────────────────────────────────────
	const required = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "S3_ENDPOINT"] as const
	for (const name of required) check(`${name} is set`, Boolean(process.env[name]))
	check("isUploadConfigured()", isUploadConfigured())

	const publicBase = process.env.S3_PUBLIC_URL
	check(
		"S3_PUBLIC_URL is set",
		Boolean(publicBase),
		publicBase ? "" : "without it every stored key mints a null URL and no video ever plays",
	)

	// A mismatch here renders thumbnails broken with no console error, because next/image refuses hosts that are not in next.config.ts.
	if (publicBase) {
		let publicHost = ""
		try {
			publicHost = new URL(publicBase).hostname
		} catch {
			check("S3_PUBLIC_URL parses as a URL", false, "check for a missing https://")
		}
		const declaredHost = process.env.NEXT_PUBLIC_UPLOAD_HOST
		check("NEXT_PUBLIC_UPLOAD_HOST is set", Boolean(declaredHost))
		if (publicHost && declaredHost)
			check(
				"NEXT_PUBLIC_UPLOAD_HOST matches S3_PUBLIC_URL's host",
				declaredHost === publicHost,
				declaredHost === publicHost ? "" : `env says "${declaredHost}", URL host is "${publicHost}"`,
			)
	}

	const endpoint = process.env.S3_ENDPOINT ?? ""
	// Check the URL's HOST, not a substring of the whole string: `includes` also passed `https://evil.example/r2.cloudflarestorage.com` and `https://r2.cloudflarestorage.com.evil.example`. Parse first, then require the exact R2 host or a subdomain of it (the account id), the same way the S3_PUBLIC_URL check above reads `.hostname`.
	let endpointHost = ""
	try {
		endpointHost = new URL(endpoint).hostname
	} catch {
		/* not a URL at all; the check below reports it */
	}
	const endpointIsHttps = endpoint.startsWith("https://")
	const endpointIsR2 = endpointHost === "r2.cloudflarestorage.com" || endpointHost.endsWith(".r2.cloudflarestorage.com")
	check(
		"S3_ENDPOINT looks like an R2 S3 endpoint",
		endpointIsHttps && endpointIsR2,
		endpointIsHttps && endpointIsR2
			? ""
			: endpointIsHttps
				? `host is "${endpointHost || "(unparseable)"}", expected https://<account-id>.r2.cloudflarestorage.com`
				: "expected https://<account-id>.r2.cloudflarestorage.com",
	)
	check("upload size cap parsed", Number.isFinite(MAX_UPLOAD_BYTES), `${MAX_UPLOAD_BYTES} bytes`)

	if (failures > 0) {
		console.log(`\n${failures} configuration problem(s), not attempting an upload.`)
		process.exit(1)
	}

	// ── The direct-upload path ─────────────────────────────────────────────────
	// Media now goes browser → bucket, so a browser needs the bucket to answer a CORS preflight for this origin. Without the rule the app still works, but every upload quietly takes the slow path through the origin, which is where Cloudflare's ~100 s limit turns a large reel into a 524.
	let appOrigin = ""
	try {
		appOrigin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "").origin
	} catch {
		/* reported below */
	}
	check(
		"NEXT_PUBLIC_APP_URL parses as an origin (needed for the CORS check)",
		Boolean(appOrigin),
		appOrigin ? "" : "set it to the public origin people use, e.g. https://halflife.hackclub.com",
	)

	if (appOrigin) {
		const presigned = await presignUpload(`posts/_smoketest/${crypto.randomUUID()}.png`, "image/png")
		const preflight = await fetch(presigned.uploadUrl, {
			headers: {
				"access-control-request-headers": "content-type",
				"access-control-request-method": "PUT",
				origin: appOrigin,
			},
			method: "OPTIONS",
		})
		const allowed = preflight.headers.get("access-control-allow-origin")
		const allowsOrigin = allowed === "*" || allowed === appOrigin
		check(
			"the bucket allows a browser PUT from the app origin",
			preflight.ok && allowsOrigin,
			preflight.ok
				? `the preflight allowed "${allowed ?? "(nothing)"}", expected "${appOrigin}". See docs/RUNBOOK.md for the CORS policy to add.`
				: `the preflight answered ${preflight.status}. Add a CORS policy allowing PUT from ${appOrigin} with the content-type header – see docs/RUNBOOK.md.`,
		)
	}

	// ── Round trip ─────────────────────────────────────────────────────────────
	const body = Buffer.from(PNG_BASE64, "base64")
	const key = `posts/_smoketest/${crypto.randomUUID()}.png`

	console.log(`\nUploading ${body.byteLength} bytes to ${key} …`)
	try {
		await putObject(key, body, "image/png")
		check("PUT to the bucket", true)
	} catch (err) {
		check("PUT to the bucket", false, err instanceof Error ? err.message : String(err))
		console.log("\nUpload failed, check the access key, secret and bucket name.")
		process.exit(1)
	}

	const url = publicUrlFor(key)
	check("publicUrlFor() minted a URL", Boolean(url))

	if (url)
		try {
			const res = await fetch(url, { cache: "no-store" })
			check(
				"the object is publicly readable",
				res.ok,
				res.ok ? `${res.status}` : await unreadableReason(res, url, key, body),
			)
			if (res.ok) {
				const fetched = Buffer.from(await res.arrayBuffer())
				check("the bytes came back identical", fetched.equals(body), `${fetched.byteLength} bytes`)
				check(
					"served as an image",
					(res.headers.get("content-type") ?? "").startsWith("image/"),
					res.headers.get("content-type") ?? "no content-type",
				)
			}
		} catch (err) {
			check("fetching the public URL", false, err instanceof Error ? err.message : String(err))
		}

	// ── Clean up ───────────────────────────────────────────────────────────────
	try {
		await deleteObject(key)
		check("DELETE the test object", true)
	} catch (err) {
		check("DELETE the test object", false, err instanceof Error ? err.message : String(err))
		console.log(`  Leftover object to remove by hand: ${key}`)
	}

	console.log(failures === 0 ? "\nR2 is wired up correctly." : `\n${failures} check(s) failed.`)
	process.exit(failures === 0 ? 0 : 1)
}

try {
	await main()
} catch (err) {
	console.error(err)
	process.exit(1)
}

export { main }
