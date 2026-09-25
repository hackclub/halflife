import "dotenv/config"

/**
 * Smoke-test the R2 wiring, end to end, with no database involved.
 *
 * Uploads a small object through the same code path `/api/upload` uses, mints
 * its public URL the way the feed does, fetches that URL over the open
 * internet, compares the bytes, and deletes it again.
 *
 * The fetch is the point. Credentials that can write and a bucket the browser
 * can read are two different things: a deployment can upload every reel
 * successfully and play none of them, and nothing in the app would say so —
 * `publicUrlFor` just returns a URL that 403s. This catches that before there
 * is a feed sitting on top of it.
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

async function main() {
  const { isUploadConfigured, putObject, publicUrlFor, deleteObject, MAX_UPLOAD_BYTES } = await import(
    "../src/lib/uploads/r2"
  )

  // ── Configuration ──────────────────────────────────────────────────────────
  const required = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "S3_ENDPOINT"] as const
  for (const name of required) {
    check(`${name} is set`, !!process.env[name])
  }
  check("isUploadConfigured()", isUploadConfigured())

  const publicBase = process.env.S3_PUBLIC_URL
  check(
    "S3_PUBLIC_URL is set",
    !!publicBase,
    publicBase ? "" : "without it every stored key mints a null URL and no video ever plays",
  )

  // A mismatch here renders thumbnails broken with no console error, because
  // next/image refuses hosts that are not in next.config.ts.
  if (publicBase) {
    let publicHost = ""
    try {
      publicHost = new URL(publicBase).hostname
    } catch {
      check("S3_PUBLIC_URL parses as a URL", false, "check for a missing https://")
    }
    const declaredHost = process.env.NEXT_PUBLIC_UPLOAD_HOST
    check("NEXT_PUBLIC_UPLOAD_HOST is set", !!declaredHost)
    if (publicHost && declaredHost) {
      check(
        "NEXT_PUBLIC_UPLOAD_HOST matches S3_PUBLIC_URL's host",
        declaredHost === publicHost,
        declaredHost === publicHost ? "" : `env says "${declaredHost}", URL host is "${publicHost}"`,
      )
    }
  }

  const endpoint = process.env.S3_ENDPOINT ?? ""
  check(
    "S3_ENDPOINT looks like an R2 S3 endpoint",
    endpoint.startsWith("https://") && endpoint.includes("r2.cloudflarestorage.com"),
    endpoint.startsWith("https://") ? "" : "expected https://<account-id>.r2.cloudflarestorage.com",
  )
  check("upload size cap parsed", Number.isFinite(MAX_UPLOAD_BYTES), `${MAX_UPLOAD_BYTES} bytes`)

  if (failures > 0) {
    console.log(`\n${failures} configuration problem(s) — not attempting an upload.`)
    process.exit(1)
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
    console.log("\nUpload failed — check the access key, secret and bucket name.")
    process.exit(1)
  }

  const url = publicUrlFor(key)
  check("publicUrlFor() minted a URL", !!url)

  if (url) {
    try {
      const res = await fetch(url, { cache: "no-store" })
      check(
        "the object is publicly readable",
        res.ok,
        res.ok
          ? `${res.status}`
          : `${res.status} ${res.statusText} — the bucket is not public. Enable the r2.dev subdomain or attach a custom domain, or reels will upload fine and never play`,
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
