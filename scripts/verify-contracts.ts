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

/**
 * The repo-sync control selects its method from a variable, so the walker above
 * cannot see which it uses. Stated here instead, which is the point of the
 * script: a method that drifts becomes a 405 the UI cannot explain.
 */
const COMPONENT_CALLS: { path: string; methods: string[] }[] = [
  { path: "/api/projects/${projectId}/repo-sync", methods: ["GET", "POST", "PUT"] },
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

for (const call of [
  ...clientCalls(),
  ...STORE_CALLS.map((c) => ({ ...c, file: "src/lib/store.tsx" })),
  ...COMPONENT_CALLS.map((c) => ({ ...c, file: "src/components/platform/RepoSyncSettings.tsx" })),
]) {
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
  const { repoSyncSettingsSchema } = await import("../src/lib/schemas/project")
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
    ["repoSync · on", repoSyncSettingsSchema, { enabled: true, repo: "https://github.com/maker/hackpad" }],
    ["repoSync · off", repoSyncSettingsSchema, { enabled: false }],
    [
      "onboarding · repo step",
      onboardingStepSchema,
      { step: "repo", enabled: true, repo: "https://github.com/maker/hackpad" },
    ],
    ["onboarding · repo skipped", onboardingStepSchema, { step: "repo", enabled: false }],
  ]

  // The sync target is a repo URL the picker offered, and only that: a bare
  // `owner/name` cannot say which forge it means, and a host-less slug is not
  // something a picker produces.
  check(
    "body · repoSync rejects a bare slug",
    !repoSyncSettingsSchema.safeParse({ enabled: true, repo: "maker/hackpad" }).success,
  )
  check(
    "body · repoSync accepts a GitLab nested-group URL",
    repoSyncSettingsSchema.safeParse({ enabled: true, repo: "https://gitlab.com/group/sub/repo" }).success,
  )

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
    ["webm · vp8 video", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...asciiBytes("V_VP8"), 0, 0, 0, 0]), true],
    ["webm · av1 video", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...asciiBytes("V_AV1"), 0, 0, 0, 0]), true],
    ["webm · audio only", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, ...asciiBytes("A_OPUS"), 0, 0, 0]), false],
    ["webm · magic only", new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]), false],
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

  /* ── 5b. Which hand-ins are pending at Ari ─────────────────────────────── */
  //
  // What the hourly retry job replays and what the admin Retry button offers:
  // in-review phases whose NEWEST open submission has no ariSubmissionId.
  const { selectPendingShips } = await import("../src/lib/ari-pending")
  const { PhaseStatus } = await import("../src/app/generated/prisma/enums")
  const at = (minutes: number) => new Date(Date.UTC(2026, 0, 1, 0, minutes))
  const projects = [
    { id: "p1", designStatus: PhaseStatus.in_review, buildStatus: PhaseStatus.draft },
    { id: "p2", designStatus: PhaseStatus.approved, buildStatus: PhaseStatus.in_review },
    { id: "p3", designStatus: PhaseStatus.draft, buildStatus: PhaseStatus.draft },
  ]
  {
    const pending = selectPendingShips(projects, [
      { themeProjectId: "p1", phase: Phase.DESIGN, ariSubmissionId: null, createdAt: at(0) },
      // Already shipped, and p3 has no open submission at all.
      { themeProjectId: "p2", phase: Phase.BUILD, ariSubmissionId: "ship_1", createdAt: at(1) },
      { themeProjectId: "p3", phase: Phase.DESIGN, ariSubmissionId: null, createdAt: at(2) },
    ])
    check(
      "ari · pending: only unsent in-review hand-ins",
      pending.length === 1 && pending[0]?.themeProjectId === "p1" && pending[0]?.phase === Phase.DESIGN,
      JSON.stringify(pending),
    )
  }
  {
    // A resubmission replaces the old row: the newest one decides.
    const pending = selectPendingShips(projects, [
      { themeProjectId: "p1", phase: Phase.DESIGN, ariSubmissionId: null, createdAt: at(0) },
      { themeProjectId: "p1", phase: Phase.DESIGN, ariSubmissionId: "ship_2", createdAt: at(5) },
    ])
    check("ari · pending: newest sent submission suppresses the phase", pending.length === 0)
  }
  {
    const pending = selectPendingShips(projects, [
      { themeProjectId: "p1", phase: Phase.DESIGN, ariSubmissionId: "ship_1", createdAt: at(0) },
      { themeProjectId: "p1", phase: Phase.DESIGN, ariSubmissionId: null, createdAt: at(5) },
    ])
    check(
      "ari · pending: newest unsent submission is listed",
      pending.length === 1 && pending[0]?.themeProjectId === "p1",
    )
  }
  check("ari · pending: no submissions means nothing pending", selectPendingShips(projects, []).length === 0)
  check("ari · pending: no projects means nothing pending", selectPendingShips([], []).length === 0)

  /* ── 5c. HCB disbursement reconciliation ──────────────────────────────── */
  //
  // The one path that decides whether a timed-out top-up is re-sent. An
  // unreadable payload must be ambiguous, never absent: "nothing landed" is
  // the state that pays twice.
  const { reconcileDisbursement } = await import("../src/lib/hcb")
  const attemptedAt = new Date(Date.UTC(2026, 0, 1, 0, 0))
  const row = (amountCents: number, createdAt: string | null) => ({
    transactionId: null,
    amountCents,
    memo: null,
    createdAt,
  })
  const listed = (...rows: ReturnType<typeof row>[]) => ({ kind: "listed" as const, rows })
  check(
    "hcb · unreadable payload is ambiguous, never absent",
    reconcileDisbursement({ kind: "unreadable" }, 3000, attemptedAt).kind === "ambiguous",
  )
  check("hcb · an empty grant is absent", reconcileDisbursement(listed(), 3000, attemptedAt).kind === "absent")
  check(
    "hcb · one matching top-up in the window landed",
    reconcileDisbursement(listed(row(3000, "2026-01-01T00:02:00Z")), 3000, attemptedAt).kind === "landed",
  )
  check(
    "hcb · two matching top-ups are ambiguous",
    reconcileDisbursement(
      listed(row(3000, "2026-01-01T00:02:00Z"), row(3000, "2026-01-01T00:03:00Z")),
      3000,
      attemptedAt,
    ).kind === "ambiguous",
  )
  check(
    "hcb · a matching top-up before the window is absent",
    reconcileDisbursement(listed(row(3000, "2025-12-30T00:00:00Z")), 3000, attemptedAt).kind === "absent",
  )
  check(
    "hcb · an unparseable timestamp is ambiguous",
    reconcileDisbursement(listed(row(3000, "not-a-date")), 3000, attemptedAt).kind === "ambiguous",
  )

  /* ── 5d. Hackatime project seconds ─────────────────────────────────────── */
  //
  // Approval reads this live, so the difference between "genuinely zero" and
  // "Hackatime no longer lists that project" decides whether someone is paid
  // zero silently or the decision is refused.
  const { projectSecondsFrom } = await import("../src/lib/hackatime")
  const stats = (...projects: { name: string; total_seconds: number }[]) => ({ data: { projects } })

  const presentZero = projectSecondsFrom(stats({ name: "firmware", total_seconds: 0 }), "firmware")
  check("hackatime · present with 0s is a live zero", presentZero.stale === false && presentZero.seconds === 0)

  const presentSeconds = projectSecondsFrom(stats({ name: "firmware", total_seconds: 4321 }), "firmware")
  check("hackatime · present seconds are read", presentSeconds.stale === false && presentSeconds.seconds === 4321)

  const renamed = projectSecondsFrom(stats({ name: "firmware-v2", total_seconds: 4321 }), "firmware")
  check(
    "hackatime · a renamed project is stale, not zero",
    renamed.stale === true && renamed.notFound === true && renamed.seconds === 0,
  )

  const missingFromEmpty = projectSecondsFrom(stats(), "firmware")
  check(
    "hackatime · a name missing from an empty list is stale",
    missingFromEmpty.stale === true && missingFromEmpty.notFound === true,
  )

  const noList = projectSecondsFrom({ data: {} }, "firmware")
  check("hackatime · a response with no list is stale", noList.stale === true && !noList.notFound)

  const nullBody = projectSecondsFrom(null, "firmware")
  check("hackatime · a null body is stale", nullBody.stale === true && !nullBody.notFound)

  /* ── 5e. Printer award transitions ─────────────────────────────────────── */
  const { canMovePrinterAward } = await import("../src/lib/printer-award")
  check(
    "printer · qualified can be locked or revoked",
    canMovePrinterAward("QUALIFIED", "ADDRESS_LOCKED") && canMovePrinterAward("QUALIFIED", "REVOKED"),
  )
  check("printer · cannot ship before packing", !canMovePrinterAward("QUALIFIED", "SHIPPED"))
  check(
    "printer · delivered is final",
    !canMovePrinterAward("DELIVERED", "SHIPPED") && !canMovePrinterAward("DELIVERED", "REVOKED"),
  )
  check("printer · revoked is final", !canMovePrinterAward("REVOKED", "PACKING"))
  check("printer · a shipped award can still be delivered", canMovePrinterAward("SHIPPED", "DELIVERED"))

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

  /* ── 6b. Repo sync file rendering ───────────────────────────────────────── */
  //
  // These files land in a maker's own repository, so their contents are the one
  // thing a person actually reads there. What the checks pin: the two paths the
  // control promises, entries ordered oldest first (a devlog reads forward),
  // the totals the project page shows, and the corrected value of an edited
  // entry rather than the original — the whole reason the file is regenerated
  // rather than appended to.
  const { renderJournal, renderBom } = await import("../src/lib/repo-sync-files")
  {
    const project = {
      id: "p1",
      title: "Hackpad",
      description: "A macropad.",
      weekId: 1,
      isWarmup: false,
      themeLabel: "PCBs",
      tier: 1,
      repoUrl: "https://github.com/maker/hackpad",
    }
    const entry = (over: Partial<import("../src/lib/repo-sync-files").JournalEntry> = {}) => ({
      id: "s1",
      phase: "DESIGN" as const,
      title: "Routed it",
      content: "<p>Wired <strong>everything</strong> up.</p>",
      hoursClaimed: 2,
      hoursApproved: null,
      effectiveDate: "2026-10-06",
      createdAt: new Date("2026-10-06T12:00:00Z"),
      timelapses: [],
      ...over,
    })

    const journal = renderJournal(project, [
      entry({ id: "s2", title: "Later", effectiveDate: "2026-10-08", createdAt: new Date("2026-10-08T12:00:00Z") }),
      entry({ id: "s1" }),
    ])
    check("repo-files · journal path", journal.path === "JOURNAL.md")
    // On the entry headings, not bare dates: the banner now carries a date too,
    // and when the newest entry dates the file that date appears above them.
    check(
      "repo-files · entries oldest first",
      journal.content.indexOf("### 2026-10-06 — Routed it") < journal.content.indexOf("### 2026-10-08 — Later"),
    )
    check("repo-files · html becomes markdown", journal.content.includes("Wired **everything** up."))
    check("repo-files · the generated banner is present", journal.content.includes("Generated by Half Life"))

    // A reviewer's adjustment is the number written, not the claim. The claim is
    // still mentioned, but only as the parenthetical annotation beside it.
    const adjusted = renderJournal(project, [entry({ hoursClaimed: 4, hoursApproved: 2 })])
    check(
      "repo-files · an approved adjustment wins",
      adjusted.content.includes("**2h** _(4h logged, adjusted by a reviewer)_") && !adjusted.content.includes("**4h**"),
    )

    // An empty project still renders a coherent file rather than a bare title.
    const empty = renderJournal(project, [])
    check("repo-files · an empty journal says so", empty.content.includes("No entries logged yet"))

    const bom = renderBom(
      project,
      [
        {
          name: "ESP32-C3",
          purpose: "Main loop",
          quantity: 2,
          unitCostUsd: 3,
          vendor: "LCSC",
          link: "https://lcsc.com/x",
          updatedAt: new Date("2026-10-06T09:00:00Z"),
        },
        {
          name: "OLED",
          purpose: "Screen",
          quantity: 1,
          unitCostUsd: 4,
          vendor: "AliExpress",
          link: null,
          updatedAt: new Date("2026-10-05T09:00:00Z"),
        },
      ],
      3,
      44,
    )
    check("repo-files · bom path", bom.path === "BOM.md")
    // 2*3 + 4 + 3 tax = 13, against a $44 tier.
    check("repo-files · bom total adds up", bom.content.includes("**$13.00**"))
    check("repo-files · bom reports what is left", bom.content.includes("$31.00 left"))
    const over = renderBom(
      project,
      [
        {
          name: "Fancy MCU",
          purpose: "Overkill",
          quantity: 1,
          unitCostUsd: 99,
          vendor: "Mouser",
          link: null,
          updatedAt: new Date("2026-10-06T09:00:00Z"),
        },
      ],
      0,
      44,
    )
    check("repo-files · bom flags an over-budget build", over.content.includes("over the tier's funding"))

    // The date in the banner has to come from the data, not the wall clock. When
    // it was `new Date()`, two renders of identical content differed, so the blob
    // SHA never matched, "skip unchanged files" never fired, and every debounced
    // sync committed a no-op diff. A render now pins the date to the newest entry
    // (or the project row), so identical content is byte-identical.
    const a = renderJournal(project, [entry()])
    const b = renderJournal(project, [entry()])
    check("repo-files · identical content renders identical bytes", a.content === b.content)
    check(
      "repo-files · the banner date tracks the newest entry, not the clock",
      a.content.includes("<!-- Generated: 2026-10-06T12:00:00.000Z -->"),
    )
    check(
      "repo-files · the banner date is not the current instant",
      (() => {
        const stamped = a.content.match(/<!-- Generated: (.+?) -->/)?.[1]
        if (!stamped) return false
        // The fixture's newest entry is 2026-10-06T12:00Z. If the banner ever
        // carries "now", it drifts forward on every run and this stays true.
        return Math.abs(Date.now() - new Date(stamped).getTime()) > 60_000
      })(),
    )
  }

  /* ── 6c. Repo references, across forges ─────────────────────────────────── */
  //
  // Three shapes reach the sync and all have to work. `githubRepo` on a project
  // is a full URL; `repoSyncRepo` — the repo the sync is pinned to — is a full
  // URL now too, but a row written before that change holds a bare `owner/name`
  // with no host. They went through one parser that assumed a URL, so
  // `new URL("owner/name")` read `owner` as the HOSTNAME, never matched
  // github.com, and refused every enable with "Pick a GitHub repo". The bare
  // form is now resolved against a named forge (the caller's), and both forms
  // are pinned here so the columns cannot drift apart again.
  //
  // GitLab is a forge we speak now, so `gitlab.com/a/b` PARSES rather than
  // being refused — the old expectation. What is refused is a host we do not
  // know (Codeberg, self-hosted Gitea), which the checks warn about rather than
  // block on.
  const { parseRepoRef } = await import("../src/lib/repo-ref")
  const { FORGES } = await import("../src/lib/forge")
  {
    // [label, input, expected fullName, forge the result must carry]
    const okCases: Array<[string, string, string, string]> = [
      ["a bare owner/name", "Heliodex/coputer", "Heliodex/coputer", "github"],
      ["a full https URL", "https://github.com/hackclub/halflife", "hackclub/halflife", "github"],
      ["a scheme-less host URL", "github.com/hackclub/halflife", "hackclub/halflife", "github"],
      ["a trailing .git", "Heliodex/coputer.git", "Heliodex/coputer", "github"],
      ["a www host", "https://www.github.com/a/b", "a/b", "github"],
      ["a GitLab URL", "https://gitlab.com/a/b", "a/b", "gitlab"],
      ["a nested GitLab group", "https://gitlab.com/group/sub/repo", "group/sub/repo", "gitlab"],
      ["a scheme-less GitLab URL", "gitlab.com/group/repo", "group/repo", "gitlab"],
    ]
    for (const [label, input, expected, forgeId] of okCases) {
      // A bare slug can only resolve against a named forge: `Heliodex/coputer
      // has no host to tell GitHub from GitLab, so the caller supplies the one
      // the sync was pinned under.
      const parsed = parseRepoRef(input, { forge: FORGES.github })
      check(
        `repo-ref · ${label} parses`,
        parsed !== null && parsed.fullName === expected && parsed.forge.id === forgeId,
        parsed ? `${parsed.forge.id}:${parsed.fullName}` : "null",
      )
    }

    // A bare slug with no forge named is genuinely ambiguous and must be refused
    // rather than guessed at.
    check("repo-ref · a bare slug without a named forge is refused", parseRepoRef("Heliodex/coputer") === null)

    const rejectCases: Array<[string, string]> = [
      ["an unknown host", "https://codeberg.org/a/b"],
      ["a single segment", "Heliodex"],
      ["three GitHub segments", "a/b/c"],
      ["a traversal attempt", "https://github.com/a/..%2f..%2fadmin"],
      ["a dot segment", "https://gitlab.com/a/../b"],
      ["an empty string", ""],
    ]
    for (const [label, input] of rejectCases) {
      check(`repo-ref · ${label} is refused`, parseRepoRef(input, { forge: FORGES.github }) === null)
    }
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
