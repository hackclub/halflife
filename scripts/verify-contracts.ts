import "dotenv/config"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { z } from "zod"

/**
 * The contract between the browser and the API.
 *
 * Neither half of this is visible to the compiler. A client sends JSON over a
 * string URL; the route parses it with a schema in another file. Get the method
 * wrong and the browser is handed a 405; get a field name wrong and `.strict()`
 * returns a 400. Both look identical from the UI — the click does nothing, the
 * optimistic state reverts on the next refresh, and nothing is logged.
 *
 * That is not hypothetical. The phone handoff read a `data` envelope the API
 * never had and threw on its first click for its entire life, and liking a reel
 * sent POST to a route that only exports PUT. Neither failed to compile, and
 * neither was caught by a verify script that exercised the library functions
 * underneath.
 *
 * Two checks, both static — this needs no database:
 *
 *   1. every method a client fetches with is exported by the route it hits
 *   2. every request body a client sends parses against that route's schema
 *
 * The bodies below are written out by hand rather than extracted, because the
 * point is to state what the client is believed to send. When one drifts, this
 * fails and names it.
 *
 * Run with `pnpm verify:contracts`.
 */

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `: ${detail}`}`)
}

/* ── 1. Methods ──────────────────────────────────────────────────────────── */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : []
  })
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const

function routeTable(): Map<string, Set<string>> {
  const table = new Map<string, Set<string>>()
  for (const file of walk("src/app/api")) {
    if (!file.endsWith("route.ts")) continue
    const source = readFileSync(file, "utf8")
    const found = new Set<string>()
    for (const method of METHODS) {
      // Both forms are in use: `export const POST = withRoute(...)` and
      // `export async function POST(...)`.
      if (new RegExp(`export (const|async function) ${method}\\b`).test(source)) found.add(method)
    }
    const url =
      "/" +
      // Either separator: `relative` hands back backslashes on Windows.
      relative("src/app", file.replace(/[\\/]route\.ts$/, ""))
        .split(/[\\/]/)
        .filter((segment) => !segment.startsWith("("))
        .join("/")
    table.set(url, found)
  }
  return table
}

function clientCalls(): { file: string; path: string; methods: string[] }[] {
  const calls: { file: string; path: string; methods: string[] }[] = []
  for (const file of [...walk("src/app"), ...walk("src/lib"), ...walk("src/components")]) {
    if (file.includes("/app/api/")) continue
    const source = readFileSync(file, "utf8")
    for (const match of source.matchAll(/fetch\(\s*(`[^`]*`|"[^"]*")([\s\S]{0,220}?)\)/g)) {
      const path = match[1]!.slice(1, -1)
      if (!path.startsWith("/api")) continue
      // A method can be a literal or a ternary; collect every literal offered.
      const methods = [...match[2]!.matchAll(/method:\s*(?:\w+\s*\?\s*)?"(\w+)"(?:\s*:\s*"(\w+)")?/g)]
        .flatMap((m) => [m[1], m[2]])
        .filter((m): m is string => Boolean(m))
      calls.push({ file, path, methods: methods.length ? methods : ["GET"] })
    }
  }
  return calls
}

/** The store posts through a helper rather than calling fetch directly. */
const STORE_CALLS: { path: string; methods: string[] }[] = [
  { path: "/api/onboarding", methods: ["POST"] },
  { path: "/api/projects/${id}", methods: ["PATCH"] },
  { path: "/api/projects/${id}/sessions", methods: ["POST"] },
  { path: "/api/projects/${id}/submit", methods: ["POST"] },
  { path: "/api/posts", methods: ["POST"] },
  { path: "/api/me", methods: ["PATCH"] },
]

const routes = routeTable()

function routeFor(path: string): Set<string> | null {
  const clean = path
    .split("?")[0]!
    .replace(/\$\{[^}]*\}/g, "X")
    .replace(/\/$/, "")
  for (const [url, methods] of routes) {
    if (new RegExp("^" + url.replace(/\[[^\]]+\]/g, "[^/]+") + "$").test(clean)) return methods
  }
  return null
}

for (const call of [...clientCalls(), ...STORE_CALLS.map((c) => ({ ...c, file: "src/lib/store.tsx" }))]) {
  const exported = routeFor(call.path)
  const label = `${call.path} [${call.methods.join("/")}]`
  if (!exported) {
    check(label, false, "no route handles this path")
    continue
  }
  const missing = call.methods.filter((m) => !exported.has(m))
  check(label, missing.length === 0, `route exports ${[...exported].sort().join("/") || "nothing"}`)
}

/* ── 2. Bodies ───────────────────────────────────────────────────────────── */

async function bodies() {
  const { onboardingStepSchema } = await import("../src/lib/schemas/onboarding")
  const { projectUpdateSchema, submitSchema } = await import("../src/lib/schemas/project")
  const { sessionCreateSchema } = await import("../src/lib/schemas/session")
  const { createPostSchema, likeSchema } = await import("../src/lib/schemas/feed")
  const { purchaseSchema } = await import("../src/lib/schemas/shop")

  const meSchema = z.object({ printerGoalId: z.string().max(80) }).strict()
  const journal = "x".repeat(200)

  const cases: [string, z.ZodType, unknown][] = [
    ["onboarding · experience", onboardingStepSchema, { step: "experience", experience: "A_LITTLE" }],
    ["onboarding · week", onboardingStepSchema, { step: "week" }],
    ["onboarding · project", onboardingStepSchema, { step: "project", title: "Macropad", description: "Three keys." }],
    ["onboarding · idea", onboardingStepSchema, { step: "idea", starterProjectId: null }],
    ["onboarding · tier", onboardingStepSchema, { step: "tier", requestedTier: 2 }],
    ["onboarding · tracking", onboardingStepSchema, { step: "tracking", dismissed: false }],
    ["addProject", projectUpdateSchema, { title: "Macropad", description: "Three keys.", requestedTier: 1 }],
    ["setProjectTier", projectUpdateSchema, { requestedTier: 3 }],
    [
      "logSession",
      sessionCreateSchema,
      {
        phase: "DESIGN",
        title: "Routed it",
        content: journal,
        hoursClaimed: 1.5,
        timelapses: [{ lapseId: "cm1lapse0000timelapse" }],
      },
    ],
    [
      "logSession · no clips",
      sessionCreateSchema,
      { phase: "BUILD", title: "Soldered", content: journal, hoursClaimed: 2, timelapses: [] },
    ],
    [
      "postReel · idea",
      createPostSchema,
      {
        kind: "IDEA",
        caption: "hello there",
        objectKey: "posts/u/a.mp4",
        checkpointKey: "w1-reel-idea",
        themeProjectId: "cmxxxxxxxxxxxxxxxxxxxxxxx",
      },
    ],
    [
      "postReel · progress",
      createPostSchema,
      {
        kind: "PROGRESS",
        caption: "ten hours in",
        objectKey: "posts/u/a.mp4",
        checkpointKey: "w3-reel-2",
        themeProjectId: null,
      },
    ],
    [
      "postReel · closing",
      createPostSchema,
      {
        kind: "SUBMISSION",
        caption: "week done",
        objectKey: "posts/u/a.mp4",
        checkpointKey: "w10-reel-submission",
        themeProjectId: null,
      },
    ],
    ["submitPhase", submitSchema, { phase: "DESIGN", notes: "it works", attachmentKeys: ["sessions/u/cart.png"] }],
    ["submitPhase · no notes", submitSchema, { phase: "BUILD", attachmentKeys: [] }],
    ["setGoal", meSchema, { printerGoalId: "bambu-a1-mini" }],
    ["like", likeSchema, { liked: true }],
    ["buy", purchaseSchema, { shopItemId: "printer-ender-3-v3-se", quantity: 1 }],
  ]

  /* ── 3. Upload key ownership ───────────────────────────────────────────── */
  //
  // Keys are not secrets: the feed returns a full video URL for every reel, so
  // any participant can read another's key. Every place a client hands one back
  // has to check it, or a stranger's timelapse becomes evidence for hours
  // nobody worked.
  const { isOwnedKey, isVideoBytes } = await import("../src/lib/uploads/r2")
  const me = "cmu7848ge00004ku8jx1dqi92"
  const you = "cmu99999900004ku8jx1dqi92"
  const keyCases: [string, boolean][] = [
    [`posts/${me}/a.mp4`, true],
    [`timelapses/${me}/b.mp4`, true],
    [`sessions/${me}/cart.png`, true],
    [`posts/${you}/a.mp4`, false],
    [`posts/${me}/../${you}/a.mp4`, false],
    [`posts/${me}/%2e%2e/${you}/a.mp4`, false],
    [`covers/${me}/a%2fb.png`, false],
    [`${me}/a.mp4`, false],
    ["a.mp4", false],
    ["", false],
  ]
  for (const [key, owned] of keyCases) {
    check(`key · ${key || "(empty)"} ${owned ? "is mine" : "is not mine"}`, isOwnedKey(me, key) === owned)
  }

  /* ── 4. Video container signatures ─────────────────────────────────────── */
  //
  // A MIME type and an extension are only claims; the bytes decide. The `ftyp`
  // box is shared with HEIC/AVIF/JPEG-2000 images, so the brand has to be a
  // video one — otherwise a still image renamed `.mp4` becomes a reel.
  const asciiBytes = (s: string) => [...s].map((c) => c.charCodeAt(0))
  const isoFile = (major: string, compatible: string[] = []) => {
    const body = [
      0,
      0,
      0,
      0,
      ...asciiBytes("ftyp"),
      ...asciiBytes(major),
      0,
      0,
      0,
      0,
      ...compatible.flatMap(asciiBytes),
    ]
    const size = body.length
    body[0] = (size >>> 24) & 0xff
    body[1] = (size >>> 16) & 0xff
    body[2] = (size >>> 8) & 0xff
    body[3] = size & 0xff
    return new Uint8Array(body)
  }
  const videoCases: [string, Uint8Array, boolean][] = [
    ["mp4 · isom", isoFile("isom", ["isom", "avc1"]), true],
    ["mp4 · unknown major, avc1 compatible", isoFile("zzzz", ["mp42", "avc1"]), true],
    ["mov · qt  ", isoFile("qt  "), true],
    ["heic · image", isoFile("heic", ["mif1", "heic"]), false],
    ["avif · image", isoFile("avif", ["avif", "mif1"]), false],
    ["webm · EBML", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), true],
    ["plain text", new TextEncoder().encode("hello world!"), false],
  ]
  for (const [name, bytes, isVideo] of videoCases) {
    check(`bytes · ${name} ${isVideo ? "is video" : "is not video"}`, isVideoBytes(bytes) === isVideo)
  }

  /* ── 5. Ari external ids ───────────────────────────────────────────────── */
  //
  // One Ari ship per (project, phase), so the external id has to survive a
  // round trip for a webhook to find the right submission.
  const { ariExternalId, parseAriExternalId } = await import("../src/lib/ari-id")
  const { Phase } = await import("../src/app/generated/prisma/enums")
  const ariDesign = ariExternalId(me, Phase.DESIGN)
  const ariBuild = ariExternalId(me, Phase.BUILD)
  check("ari · design external id", ariDesign === `${me}:design`, ariDesign)
  check("ari · build external id", ariBuild === `${me}:build`, ariBuild)
  check("ari · design parses back", parseAriExternalId(ariDesign)?.phase === Phase.DESIGN)
  check("ari · build parses back", parseAriExternalId(ariBuild)?.phase === Phase.BUILD)
  check("ari · project id survives", parseAriExternalId(ariDesign)?.themeProjectId === me)
  check("ari · rejects junk", parseAriExternalId("not-an-id") === null)
  check("ari · rejects empty project", parseAriExternalId(":design") === null)

  /* ── 6. Journal image count ─────────────────────────────────────────────── */
  //
  // The evidence bar counts pictures, so the same picture pasted twice must
  // count once — otherwise one image copied down an entry clears it.
  const { countImages } = await import("../src/components/platform/Markdown")
  const imageCases: [string, number][] = [
    ["", 0],
    ["![a](https://x/a.png)", 1],
    ["![a](https://x/a.png)![a](https://x/a.png)", 1],
    ["![a](https://x/a.png)![b](https://x/b.png)", 2],
    ["![a](https://x/a.png) ![b](https://x/a.png) ![c](https://x/b.png)", 2],
    ["![a](javascript:alert(1))", 0],
    ["![a](https://x/a.png)![b](javascript:x)", 1],
  ]
  for (const [source, expected] of imageCases) {
    check(`images · "${source.slice(0, 40)}" → ${expected}`, countImages(source) === expected)
  }

  for (const [name, schema, body] of cases) {
    const parsed = schema.safeParse(body)
    check(
      `body · ${name}`,
      parsed.success,
      parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; "),
    )
  }
}

bodies()
  .then(() => {
    console.log(failures === 0 ? "\nAll contract checks passed." : `\n${failures} check(s) failed.`)
    process.exitCode = failures === 0 ? 0 : 1
  })
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
