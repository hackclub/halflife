import "dotenv/config"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { z } from "zod"

/**
 * The contract between the browser and the API.
 *
 * Neither half of this is visible to the compiler. A client sends JSON over a string URL; the route parses it with a schema in another file. Get the method wrong and the browser is handed a 405; get a field name wrong and `.strict()` returns a 400. Both look identical from the UI – the click does nothing, the optimistic state reverts on the next refresh, and nothing is logged.
 *
 * That is not hypothetical. The phone handoff read a `data` envelope the API never had and threw on its first click for its entire life, and liking a reel sent POST to a route that only exports PUT. Neither failed to compile, and neither was caught by a verify script that exercised the library functions underneath.
 *
 * Two checks, both static – this needs no database:
 *
 * 1. every method a client fetches with is exported by the route it hits
 * 2. every request body a client sends parses against that route's schema
 *
 * The bodies below are written out by hand rather than extracted, because the point is to state what the client is believed to send. When one drifts, this fails and names it.
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
			// Both forms are in use: `export const POST = withRoute(...)` and `export async function POST(...)`.
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
			// Group 1 is always there when the regex matched; the fallback keeps the type honest without a non-null assertion.
			const path = match[1]?.slice(1, -1) ?? ""
			if (!path.startsWith("/api")) continue
			// A method can be a literal or a ternary; collect every literal offered.
			const methods = [...(match[2] ?? "").matchAll(/method:\s*(?:\w+\s*\?\s*)?"(\w+)"(?:\s*:\s*"(\w+)")?/g)]
				.flatMap((m) => [m[1], m[2]])
				.filter((m): m is string => Boolean(m))
			calls.push({ file, path, methods: methods.length ? methods : ["GET"] })
		}
	}
	return calls
}

/** The store posts through a helper rather than calling fetch directly. */
// The `${…}` below are the shape of a path, written out by hand on purpose: the point of the table is to state what the client is believed to send, and interpolating a real value would check the wrong thing.
const STORE_CALLS: { path: string; methods: string[] }[] = [
	{ path: "/api/onboarding", methods: ["POST"] },
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a path shape, written out by hand
	{ path: "/api/projects/${id}", methods: ["PATCH"] },
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a path shape, written out by hand
	{ path: "/api/projects/${id}/sessions", methods: ["POST"] },
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a path shape, written out by hand
	{ path: "/api/projects/${id}/submit", methods: ["POST"] },
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a path shape, written out by hand
	{ path: "/api/projects/${id}/link-sync-repo", methods: ["POST"] },
	{ path: "/api/posts", methods: ["POST"] },
	{ path: "/api/goal", methods: ["PATCH"] },
]

/**
 * The repo-sync control selects its method from a variable, so the walker above cannot see which it uses. Stated here instead, which is the point of the script: a method that drifts becomes a 405 the UI cannot explain.
 */
const COMPONENT_CALLS: { path: string; methods: string[] }[] = [
	// biome-ignore lint/suspicious/noTemplateCurlyInString: a path shape, written out by hand
	{ path: "/api/projects/${projectId}/repo-sync", methods: ["GET", "POST", "PUT"] },
]

const routes = routeTable()

function routeFor(path: string): Set<string> | null {
	const clean = (path.split("?")[0] ?? "").replace(/\$\{[^}]*\}/g, "X").replace(/\/$/, "")
	// A static segment beats the variable one it shares a slot with – `bom/import` is its own route, not `bom/[itemId]` – and Next resolves it that way, so a client calling `bom/import` must be checked against the import route. The fewest variables is that rule spelled out; without it the walker could hand back `[itemId]` and report a POST as a 405 that Next would never send.
	let best: { methods: Set<string>; dynamic: number } | null = null
	for (const [url, methods] of routes) {
		if (!new RegExp(`^${url.replace(/\[[^\]]+\]/g, "[^/]+")}$`).test(clean)) continue
		const dynamic = (url.match(/\[/g) ?? []).length
		if (!best || dynamic < best.dynamic) best = { methods, dynamic }
	}
	return best?.methods ?? null
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
	const { bomImportSchema, repoSyncSettingsSchema } = await import("../src/lib/schemas/project")
	const { purchaseSchema } = await import("../src/lib/schemas/shop")
	const { setGoalSchema } = await import("../src/lib/schemas/goal")
	const { createReportSchema } = await import("../src/lib/schemas/report")
	const { shopRegionSchema, itemRegionPriceSchema } = await import("../src/lib/schemas/admin")
	const { programEventCreateSchema, programEventUpdateSchema } = await import("../src/lib/schemas/admin")
	const { shopRegionPreferenceSchema } = await import("../src/lib/schemas/shop")

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
		["takeStarter", projectUpdateSchema, { starterProjectId: "starbie", requestedTier: 1 }],
		["dropStarter", projectUpdateSchema, { starterProjectId: null }],
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
		// The printer branch carries a machine and the two funding branches must not. The store sends `{ goal }` alone for those, so a schema that grew a required printer would break every one of them at once.
		["setGoal · printer", setGoalSchema, { goal: "PRINTER", printerGoalId: "bambu-a1-mini" }],
		["setGoal · funding all weeks", setGoalSchema, { goal: "FULL_FUNDING" }],
		["setGoal · funding some weeks", setGoalSchema, { goal: "PARTIAL_FUNDING" }],
		["like", likeSchema, { liked: true }],
		["shopRegion", shopRegionSchema, { id: "eu", name: "Europe" }],
		["itemRegionPrice", itemRegionPriceSchema, { regionId: "eu", priceCredits: 40 }],
		["itemRegionPrice · clear", itemRegionPriceSchema, { regionId: "eu", priceCredits: null }],
		["shopRegionPreference", shopRegionPreferenceSchema, { regionId: "eu" }],
		["shopRegionPreference · default", shopRegionPreferenceSchema, { regionId: null }],
		[
			"report",
			createReportSchema,
			{ target: "REEL", targetId: "cmxxxxxxxxxxxxxxxxxxxxxxx", reason: "SPAM", details: "same clip five times" },
		],
		["buy", purchaseSchema, { shopItemId: "printer-ender-3-v3-se", quantity: 1 }],
		["repoSync · on", repoSyncSettingsSchema, { enabled: true, repo: "https://github.com/maker/hackpad" }],
		["repoSync · off", repoSyncSettingsSchema, { enabled: false }],
		// The import body is optional in full: an empty POST is the preview, which is the harmless act, and the client only says `apply` when it means it.
		["bomImport · preview", bomImportSchema, {}],
		["bomImport · apply replace", bomImportSchema, { apply: true, replace: true }],
		[
			"onboarding · repo step",
			onboardingStepSchema,
			{ step: "repo", enabled: true, repo: "https://github.com/maker/hackpad" },
		],
		["onboarding · repo skipped", onboardingStepSchema, { step: "repo", enabled: false }],
		[
			"programEvent · create",
			programEventCreateSchema,
			{
				title: "Weekly office hours",
				colour: "CORAL",
				description: "Bring whatever is stuck.",
				startsAt: "2026-10-13T19:00:00.000Z",
				endsAt: "2026-10-13T20:00:00.000Z",
				published: true,
				repeatWeeks: 4,
			},
		],
		// The whole series is a create-only field: an edit moves one occurrence.
		["programEvent · edit", programEventUpdateSchema, { title: "Moved to 8", colour: "SKY", endsAt: null }],
	]

	// The sync target is a repo URL the picker offered, and only that: a bare `owner/name` cannot say which forge it means, and a host-less slug is not something a picker produces.
	check(
		"body · repoSync rejects a bare slug",
		!repoSyncSettingsSchema.safeParse({ enabled: true, repo: "maker/hackpad" }).success,
	)
	check(
		"body · repoSync accepts a GitLab nested-group URL",
		repoSyncSettingsSchema.safeParse({ enabled: true, repo: "https://gitlab.com/group/sub/repo" }).success,
	)
	// An empty body is a preview, not a write: the defaults have to be false on both axes or a stray POST would replace the list.
	const importDefaults = bomImportSchema.safeParse({})
	check(
		"body · bomImport defaults to a preview, not a write",
		importDefaults.success && importDefaults.data.apply === false && importDefaults.data.replace === false,
	)
	check("body · bomImport rejects an unknown field", !bomImportSchema.safeParse({ write: true }).success)

	/* ── 2b. fetchWithRetry ─────────────────────────────────────────────────── */
	//
	// A transient failure at an identity endpoint used to abort an OAuth callback with a raw TimeoutError. The retry is the fix, and these pin the parts that matter: it retries what is worth retrying, leaves a 4xx alone, gives up after the retries, and never leaks an oversized body into memory.
	{
		const { fetchWithRetry } = await import("../src/lib/fetch-retry")
		const realFetch = globalThis.fetch

		// Silence the waits; the tests are about attempts, not wall time.
		const originalSetTimeout = globalThis.setTimeout
		await (async () => {
			globalThis.setTimeout = ((fn: () => void) => {
				fn()
				return 0
			}) as unknown as typeof setTimeout
			try {
				// A transport error twice, then success: two failures, one answer.
				let attempts = 0
				globalThis.fetch = (async () => {
					attempts++
					if (attempts < 3) {
						const err = new Error("aborted") as Error & { name: string }
						err.name = "TimeoutError"
						throw err
					}
					return new Response('{"ok":true}', { status: 200 })
				}) as typeof fetch
				const res = await fetchWithRetry("https://example.test/a", { retries: 2 })
				check("fetch-retry · a timeout is retried until it lands", attempts === 3 && res.status === 200)

				// A 4xx is a real answer, not a blip.
				let seen = 0
				globalThis.fetch = (async () => {
					seen++
					return new Response("nope", { status: 401 })
				}) as typeof fetch
				const unauthorized = await fetchWithRetry("https://example.test/b", { retries: 2 })
				check("fetch-retry · a 4xx is not retried", seen === 1 && unauthorized.status === 401)

				// A 5xx is worth another go.
				let fives = 0
				globalThis.fetch = (async () => {
					fives++
					return new Response("bad", { status: 503 })
				}) as typeof fetch
				const down = await fetchWithRetry("https://example.test/c", { retries: 2 })
				check("fetch-retry · a 5xx is retried then returned", fives === 3 && down.status === 503)

				// Exhausting the retries throws rather than returning nothing.
				let threw = false
				globalThis.fetch = (async () => {
					const err = new Error("nope") as Error & { name: string }
					err.name = "TimeoutError"
					throw err
				}) as typeof fetch
				try {
					await fetchWithRetry("https://example.test/d", { retries: 1 })
				} catch {
					threw = true
				}
				check("fetch-retry · a persistent failure throws", threw)

				// A body larger than the cap is refused rather than buffered whole.
				globalThis.fetch = (async () =>
					new Response("x", { status: 200, headers: { "content-length": String(8 * 1024 * 1024) } })) as typeof fetch
				let oversizeThrew = false
				try {
					await fetchWithRetry("https://example.test/e", { retries: 0 })
				} catch {
					oversizeThrew = true
				}
				check("fetch-retry · an oversized body is refused", oversizeThrew)
			} finally {
				globalThis.fetch = realFetch
				globalThis.setTimeout = originalSetTimeout
			}
		})()
	}

	/* ── 3. Upload key ownership ───────────────────────────────────────────── */
	//
	// Keys are not secrets: the feed returns a full video URL for every reel, so any participant can read another's key. Every place a client hands one back has to check it, or a stranger's timelapse becomes evidence for hours nobody worked.
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
	// A MIME type and an extension are only claims; the bytes decide. The `ftyp` box is shared with HEIC/AVIF/JPEG-2000 images, so the brand has to be a video one – otherwise a still image renamed `.mp4` becomes a reel.
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
	// One Ari ship per (project, phase), so the external id has to survive a round trip for a webhook to find the right submission.
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
	// What the hourly retry job replays and what the admin Retry button offers: in-review phases whose NEWEST open submission has no ariSubmissionId.
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
	// The one path that decides whether a timed-out top-up is re-sent. An unreadable payload must be ambiguous, never absent: "nothing landed" is the state that pays twice.
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
	// Approval reads this live, so the difference between "genuinely zero" and "Hackatime no longer lists that project" decides whether someone is paid zero silently or the decision is refused.
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

	/* ── 5d-ii. Hackatime spans, and the overlap arithmetic ────────────────── */
	//
	// Someone who codes with Hackatime running and records a Lapse timelapse of the same sitting had it counted twice: once by the journal entry, once by the linked project. These decide how much comes off, so the boundaries are the whole risk – an off-by-one here is somebody underpaid.
	const { spansFrom } = await import("../src/lib/hackatime")
	const {
		cachedSpansCover,
		capSubtraction,
		mergeIntervals,
		overlapSeconds,
		parseCachedSpans,
		spanWindowFor,
		timelapseWindow,
	} = await import("../src/lib/hours-overlap")

	const spanList = (...spans: { start_time: number; end_time: number }[]) => ({ spans })
	const read = spansFrom(spanList({ start_time: 1000, end_time: 1600 }, { start_time: 1700, end_time: 2000 }))
	check(
		"hackatime spans · two spans are read",
		read.stale === false && read.spans.length === 2 && read.spans[0]?.start === 1000,
	)

	// An empty list is a real answer: the project was tracked at no time in the window. A missing list is not, and must never read as "no overlap".
	const emptyList = spansFrom(spanList())
	check("hackatime spans · an empty list is a finding", emptyList.stale === false && emptyList.spans.length === 0)

	const noSpans = spansFrom({ data: {} })
	check("hackatime spans · a response with no spans is stale", noSpans.stale === true && noSpans.spans.length === 0)

	const nullSpans = spansFrom(null)
	check("hackatime spans · a null body is stale", nullSpans.stale === true)

	// One malformed row costs that row, not the participant's hours.
	const mixed = spansFrom(spanList({ start_time: 1000, end_time: 1600 }, { start_time: null, end_time: 5 } as never))
	check(
		"hackatime spans · a malformed row is dropped, the rest survive",
		mixed.stale === false && mixed.spans.length === 1,
	)

	// A backwards span is not time anybody spent.
	const backwards = spansFrom(spanList({ start_time: 1600, end_time: 1000 }))
	check("hackatime spans · a backwards span is dropped", backwards.spans.length === 0)

	// The headline case: a two-hour recording, entirely inside two hours of tracked time on the linked project. All of it is double-counted. Every case below needs a window, so an absent one would make the checks vacuously true. Asserted once here rather than in each.
	const recording = timelapseWindow(1_700_000_000_000, 7200)
	check("overlap · a recording with a start and duration is a window", recording !== null)

	// The subtraction as the ledger applies it: a journal entry claiming two hours with a two-hour recording, beside a link reporting two hours tracked over the same period. Five hours claimed, three hours of actual work.
	const { rollUpHours } = await import("../src/lib/hours")
	const { HoursSource: Source, Phase: ReviewPhase } = await import("../src/app/generated/prisma/enums")
	const oneEntry = [
		{
			hoursClaimed: 2,
			hoursApproved: null,
			hoursSource: Source.MANUAL,
			timelapses: [{ recordedAt: new Date(1_700_000_000_000), coveredSeconds: 7200 }],
		},
	]
	const twoHoursTracked = [
		{
			hoursApproved: null,
			cachedSeconds: 7200,
			cachedSpans: { from: 1_699_000_000, to: 1_701_000_000, spans: [{ start: 1_700_000_000, end: 1_700_007_200 }] },
		},
	]

	const deduped = rollUpHours(oneEntry, twoHoursTracked, null)
	check(
		"rollup · the same sitting counts once, not twice",
		deduped.computedTotal === 2 && deduped.journalHours === 2 && deduped.hackatimeHours === 0,
		`got total ${deduped.computedTotal}, hackatime ${deduped.hackatimeHours}`,
	)
	check("rollup · the subtracted overlap is reported", deduped.hackatimeOverlapSeconds === 7200)

	// Genuinely different work on the same project stays additive: an hour of building that was never recorded, plus an hour recorded and tracked.
	const distinct = rollUpHours(oneEntry, [{ hoursApproved: null, cachedSeconds: 3600, cachedSpans: null }], null)
	check(
		"rollup · untracked hours still add to a journal entry",
		distinct.computedTotal === 3,
		`got ${distinct.computedTotal}`,
	)

	// A link whose tracking is outside the recording's window is not overlap.
	const elsewhere = rollUpHours(
		oneEntry,
		[
			{
				hoursApproved: null,
				cachedSeconds: 7200,
				cachedSpans: { from: 1_600_000_000, to: 1_601_000_000, spans: [{ start: 1_600_000_000, end: 1_600_007_200 }] },
			},
		],
		null,
	)
	check(
		"rollup · tracking from another day is still counted",
		elsewhere.computedTotal === 4,
		`got ${elsewhere.computedTotal}`,
	)

	// A reviewer override is a decision, not a computed value, and stands.
	const overridden = rollUpHours(oneEntry, [{ hoursApproved: 5, cachedSeconds: 7200, cachedSpans: null }], null)
	check(
		"rollup · a reviewer override is not deduplicated",
		overridden.hackatimeHours === 5 && overridden.computedTotal === 7,
		`got ${overridden.computedTotal}`,
	)

	// The common case: nobody records anything, so there is nothing to compare and the two tools add up as they always did.
	const noTimelapses = [{ hoursClaimed: 3, hoursApproved: null, hoursSource: Source.MANUAL }]
	check(
		"rollup · an unrecorded project is unchanged",
		rollUpHours(noTimelapses, twoHoursTracked, null).computedTotal === 5,
	)
	check(
		"rollup · a HACKATIME_TRACKED entry still contributes nothing",
		rollUpHours(
			[
				{
					hoursClaimed: 2,
					hoursApproved: null,
					hoursSource: Source.HACKATIME_TRACKED,
					timelapses: [{ recordedAt: new Date(1_700_000_000_000), coveredSeconds: 7200 }],
				},
			],
			twoHoursTracked,
			null,
		).computedTotal === 2,
		"its recording must not subtract from a link that already carries its time",
	)

	// A frozen phase keeps the number it was approved at.
	check(
		"rollup · a frozen phase reports its frozen total",
		rollUpHours(oneEntry, twoHoursTracked, 9).effectiveHours === 9,
	)
	// Present so the enum import is exercised rather than merely referenced.
	check("rollup · the phase enum is the one the schema defines", ReviewPhase.DESIGN === "DESIGN")

	// A cold span cache is the complaint this whole check exists for: the same sitting, the same link, and the total silently doubles because the subtraction could not run. The number is now flagged, so a screen showing it can say the check never happened rather than presenting an inflated total as fact.
	const coldCache = rollUpHours(oneEntry, [{ hoursApproved: null, cachedSeconds: 7200, cachedSpans: null }], null)
	check(
		"rollup · a cold span cache is reported as unchecked",
		coldCache.hackatimeOverlapUnknown === true && coldCache.hackatimeOverlapSeconds === 0,
		`unknown=${coldCache.hackatimeOverlapUnknown} overlap=${coldCache.hackatimeOverlapSeconds}`,
	)
	check(
		"rollup · an unchecked overlap leaves the double count in rather than guessing at it",
		coldCache.computedTotal === 4,
		`got ${coldCache.computedTotal}`,
	)
	check("rollup · a warm cache reports the overlap as checked", deduped.hackatimeOverlapUnknown === false)
	check(
		"rollup · a phase with no recording has nothing to check",
		rollUpHours(noTimelapses, [{ hoursApproved: null, cachedSeconds: 3600, cachedSpans: null }], null)
			.hackatimeOverlapUnknown === false,
	)
	// A reviewer override is a decision, not a computed value: it must not be reported as an unchecked overlap either, or every decided phase would carry a warning it cannot act on.
	check(
		"rollup · an overridden link is never an unchecked overlap",
		rollUpHours(oneEntry, [{ hoursApproved: 5, cachedSeconds: 7200, cachedSpans: null }], null)
			.hackatimeOverlapUnknown === false,
	)

	// A caller that narrows its Prisma select hands over `undefined` where a number was expected, and `undefined !== null` used to read as an override and add NaN to the total. NaN is the worst shape of wrong here: it renders as "NaNh" in one place and leaves the rest of the phase looking fine.
	const missingOverride = rollUpHours(oneEntry, [{ cachedSeconds: 7200, cachedSpans: null }] as never, null)
	check(
		"rollup · a link missing hoursApproved is not read as an override",
		Number.isFinite(missingOverride.hackatimeHours) && missingOverride.hackatimeHours === 2,
		`got hackatime ${missingOverride.hackatimeHours}`,
	)
	check(
		"rollup · a link missing cachedSeconds counts as nothing rather than NaN",
		rollUpHours(oneEntry, [{ hoursApproved: null }] as never, null).hackatimeHours === 0,
	)
	const missingClaim = rollUpHours([{ hoursSource: Source.MANUAL }] as never, [], null)
	check(
		"rollup · a session missing its hours counts as nothing rather than NaN",
		missingClaim.journalHours === 0 && Number.isFinite(missingClaim.computedTotal),
		`got ${missingClaim.journalHours}`,
	)

	// The headline case: a two-hour recording, entirely inside the two hours of tracked time on the linked project. All of it is double-counted.
	check(
		"overlap · a recording fully inside tracked time is all overlap",
		recording !== null && overlapSeconds([recording], [{ start: 1_700_000_000, end: 1_700_007_200 }]) === 7200,
	)

	// A recording that overruns the tracked time gives up only what tracked.
	check(
		"overlap · only the tracked part of a recording is overlap",
		recording !== null && overlapSeconds([recording], [{ start: 1_700_000_000, end: 1_700_001_800 }]) === 1800,
	)

	// Two recordings either side of a break: neither overlaps, and the gap between them is not counted as anything.
	const twoRecordings = [timelapseWindow(1_700_000_000_000, 600), timelapseWindow(1_700_003_000_000, 600)].filter(
		(w) => w !== null,
	)
	check(
		"overlap · a tracked span between two recordings overlaps neither",
		overlapSeconds(twoRecordings, [{ start: 1_700_001_000, end: 1_700_002_000 }]) === 0,
	)

	// Recording A runs into recording B: the shared minutes are claimed twice by the journal, and must be counted once before being subtracted.
	const overlapping = [timelapseWindow(1_700_000_000_000, 3600), timelapseWindow(1_700_001_800_000, 3600)].filter(
		(w) => w !== null,
	)
	check(
		"overlap · a minute inside two recordings is counted once",
		overlapSeconds(overlapping, [{ start: 1_700_003_000, end: 1_700_003_600 }]) === 600,
	)

	// Two spans either side of a gap, both inside one recording: the gap between them is not tracked time and must not be charged to Hackatime.
	const hourRecording = timelapseWindow(1_700_000_000_000, 3600)
	check(
		"overlap · an untracked gap inside a recording is not overlap",
		hourRecording !== null &&
			overlapSeconds(
				[hourRecording],
				[
					{ start: 1_700_000_000, end: 1_700_000_600 },
					{ start: 1_700_003_000, end: 1_700_003_600 },
				],
			) === 1200,
	)

	// Nothing to compare, and a touching pair: 600, not 1200.
	check("overlap · no tracked time is no overlap", overlapSeconds(twoRecordings, []) === 0)
	check(
		"overlap · two spans touching at a point share no time",
		hourRecording !== null &&
			overlapSeconds(
				[hourRecording],
				[
					{ start: 1_699_999_400, end: 1_700_000_000 },
					{ start: 1_700_000_000, end: 1_700_003_600 },
				],
			) === 3600,
	)

	// Hackatime's spans carry up to two minutes of padding past a gap, so their sum can exceed the project total. A subtraction larger than what is there would print a negative hour, which is worse than a duplicated one.
	check("overlap · a subtraction is capped at the link's own seconds", capSubtraction(3600, 7200) === 3600)
	check("overlap · nothing to subtract from subtracts nothing", capSubtraction(0, 7200) === 0)
	check("overlap · junk subtracts nothing", capSubtraction(Number.NaN, 7200) === 0)

	// Without a start there is no window, and inventing one from the row's own created_at would subtract the wrong sitting's time.
	check("overlap · no recording start means no window", timelapseWindow(null, 7200) === null)
	check("overlap · a zero-length recording is no window", timelapseWindow(1_700_000_000_000, 0) === null)

	// Merging is what stops two windows describing one minute from counting it twice on the way in.
	check(
		"overlap · overlapping windows merge into one",
		mergeIntervals([
			{ start: 0, end: 100 },
			{ start: 50, end: 150 },
		]).length === 1 &&
			mergeIntervals([
				{ start: 0, end: 100 },
				{ start: 50, end: 150 },
			])[0]?.end === 150,
	)
	check(
		"overlap · touching windows merge into one",
		mergeIntervals([
			{ start: 0, end: 100 },
			{ start: 100, end: 200 },
		]).length === 1,
	)
	check(
		"overlap · disjoint windows stay apart",
		mergeIntervals([
			{ start: 0, end: 100 },
			{ start: 200, end: 300 },
		]).length === 2,
	)

	// Cached spans carry the window they were fetched for. A cached answer to a narrower question is not an answer, and must force a refetch rather than conclude "no overlap" about minutes it never covered.
	const cache = parseCachedSpans({ from: 100, to: 200, spans: [{ start: 100, end: 200 }] })
	check("overlap · cached spans are read back", cache !== null && cache.spans.length === 1)
	check("overlap · a cache covering the window is used", cache !== null && cachedSpansCover(cache, 120, 180) === true)
	check(
		"overlap · a cache narrower than the window is not used",
		cache !== null && cachedSpansCover(cache, 50, 180) === false && cachedSpansCover(cache, 120, 250) === false,
	)
	// A shape this did not write is no cache at all: one refetch, not a wrong answer.
	check("overlap · an unrecognised cache shape is ignored", parseCachedSpans([{ start: 1, end: 2 }]) === null)
	check("overlap · a null cache is ignored", parseCachedSpans(null) === null)

	// The fetch window covers every recording, with slack for clock drift.
	const fetchWindow = spanWindowFor([
		{ start: 1_700_000_000, end: 1_700_003_600 },
		{ start: 1_700_010_000, end: 1_700_010_600 },
	])
	check(
		"overlap · the fetch window spans every recording plus an hour",
		fetchWindow !== null &&
			fetchWindow.fromSeconds === 1_700_000_000 - 3600 &&
			fetchWindow.toSeconds === 1_700_010_600 + 3600,
	)
	check("overlap · no recordings means no window to fetch", spanWindowFor([]) === null)

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
	// The evidence bar counts pictures, so the same picture pasted twice must count once – otherwise one image copied down an entry clears it.
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
	// These files land in a maker's own repository, so their contents are the one thing a person actually reads there. What the checks pin: the two paths the control promises, entries ordered oldest first (a devlog reads forward), the totals the project page shows, and the corrected value of an edited entry rather than the original – the whole reason the file is regenerated rather than appended to.
	const { renderJournal, renderBom } = await import("../src/lib/repo-sync-files")
	const { projectUrl } = await import("../src/lib/app-url")
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
		// On the entry headings, not bare dates: the banner now carries a date too, and when the newest entry dates the file that date appears above them.
		check(
			"repo-files · entries oldest first",
			journal.content.indexOf("### 2026-10-06 – Routed it") < journal.content.indexOf("### 2026-10-08 – Later"),
		)
		check("repo-files · html becomes markdown", journal.content.includes("Wired **everything** up."))
		check("repo-files · the generated banner is present", journal.content.includes("Generated by Half Life"))
		// The project link is the one thing in the file that points back at the platform's copy of this project rather than the marketing site, so it is the one that a wrong origin would quietly make useless.
		check(
			"repo-files · the journal links the project page",
			journal.content.includes(`[open the project](${projectUrl(project.id)})`),
		)
		// Absolute, and never a bare `/projects/...`: a repo is read outside the app, where a relative link resolves to the forge. Unset, the origin falls back to the real site rather than dropping the link.
		check("repo-files · the project link is absolute", /^https?:\/\/[^/]+\/projects\/p1$/.test(projectUrl(project.id)))

		// A reviewer's adjustment is the number written, not the claim. The claim is still mentioned, but only as the parenthetical annotation beside it.
		const adjusted = renderJournal(project, [entry({ hoursClaimed: 4, hoursApproved: 2 })])
		check(
			"repo-files · an approved adjustment wins",
			adjusted.content.includes("**2h** _(4h logged, adjusted by a reviewer)_") && !adjusted.content.includes("**4h**"),
		)

		// An empty project still renders a coherent file rather than a bare title.
		const empty = renderJournal(project, [])
		check("repo-files · an empty journal says so", empty.content.includes("No entries logged yet"))

		const bom = renderBom(
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
		)
		check("repo-files · bom path", bom.path === "BOM.csv")
		// The header names the shape a spreadsheet expects.
		check("repo-files · bom header", bom.content.startsWith("Item,Qty,Supplier,Cost/item,Total Cost,link\n"))
		// A vendor without a link is a bare cell; a part with one keeps its link.
		check("repo-files · bom vendor cell", bom.content.includes("ESP32-C3,2,LCSC,$3.00,$6.00,https://lcsc.com/x"))
		check("repo-files · bom empty link cell", bom.content.includes("OLED,1,AliExpress,$4.00,$4.00,"))
		// Shipping is a line item, not a footer, so the Total Cost column sums to the real total.
		check("repo-files · bom shipping line", bom.content.includes("Estimated total shipping,1,,,$3.00,"))
		// A link holding a comma is quoted, or it would split the row.
		const comma = renderBom(
			[
				{
					name: "Comma part",
					purpose: null,
					quantity: 1,
					unitCostUsd: 1,
					vendor: null,
					link: "https://example.com/?a=1,b=2",
					updatedAt: new Date("2026-10-06T09:00:00Z"),
				},
			],
			0,
		)
		check("repo-files · bom quotes a link with a comma", comma.content.includes('"https://example.com/?a=1,b=2"'))

		// The old markdown BOM is deleted on every sync, so a repo synced before the CSV move never carries both.
		const { legacyBomDeletion, LEGACY_BOM_PATH } = await import("../src/lib/repo-sync-files")
		const legacy = legacyBomDeletion()
		check("repo-files · legacy bom deletion path", legacy.path === LEGACY_BOM_PATH && LEGACY_BOM_PATH === "BOM.md")
		check("repo-files · legacy bom deletion is a delete", legacy.content === null)

		// The date in the banner has to come from the data, not the wall clock. When it was `new Date()`, two renders of identical content differed, so the blob SHA never matched, "skip unchanged files" never fired, and every debounced sync committed a no-op diff. A render now pins the date to the newest entry (or the project row), so identical content is byte-identical.
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
				// The fixture's newest entry is 2026-10-06T12:00Z. If the banner ever carries "now", it drifts forward on every run and this stays true.
				return Math.abs(Date.now() - new Date(stamped).getTime()) > 60_000
			})(),
		)
	}

	/* ── 6bb. Reading a BOM CSV out of a repo ───────────────────────────────── */
	//
	// A maker's repo carries whatever their tool exported, so the importer is pinned on the shapes that actually turn up: a hand-kept spreadsheet whose price column says `Rs. 1300 (~ $15)`, a KiCad export with a commented preamble and a comma inside a quoted description, and a link column that holds `JLCPCB` as often as a URL.
	const { parseBomCsv } = await import("../src/lib/bom-csv")
	{
		const messy = [
			'"Item","Qty","Link","Price","Running total"',
			'"Keycaps","1 set","https://stackskb.com/store/keycaps/","Rs. 1300 (~ $15)","Rs. 1300 ($15)"',
			'"Switches","100pc","https://www.thecosmicbyte.com/p/1","Rs. 2000 (~ $25)","Rs. 3300 ($40)"',
			'"EC11 rotary encoder","1","-","0","Rs. 4120 ($49.2)"',
			'"PCB","1","JLCPCB","$25.3 (~Rs. 2300)","Rs. 7320 ($83.5)"',
			'"Shipping (Guesstimate)","-","-","$25 (~Rs. 2500)","Rs. 11090 ($120.5)"',
		].join("\n")
		const parsed = parseBomCsv(messy)
		check("bom-csv · the header is found", parsed.header?.[0] === "Item")
		check(
			"bom-csv · the shipping line is not a part",
			parsed.skipped.some((s) => s.name === "Shipping (Guesstimate)"),
		)
		check("bom-csv · a dollar amount is read out of a rupee price", parsed.lines[0]?.unitCostUsd === 15)
		check("bom-csv · a count in words becomes a number", parsed.lines[0]?.quantity === 1)
		check("bom-csv · `100pc` becomes 100", parsed.lines[1]?.quantity === 100)
		check("bom-csv · a vendor is derived from an unknown link host", parsed.lines[1]?.vendor === "Cosmic Byte")
		check("bom-csv · a known host names its vendor", parsed.lines[0]?.vendor === "StacksKB")
		check("bom-csv · a dash is not a link", parsed.lines[2]?.link === null && parsed.lines[2]?.unitCostUsd === 0)
		check("bom-csv · a bare word is not a link", parsed.lines[3]?.link === null)
		check("bom-csv · a price without a currency is read", parsed.lines[3]?.unitCostUsd === 25.3)
		check("bom-csv · five data rows, four parts", parsed.lines.length === 4 && parsed.skipped.length === 1)

		const kicad = [
			"# BOM for Hackpad",
			"# Generated 2026-01-01",
			'"Comment","Designator","Footprint","Quantity","Supplier","Link"',
			'"ESP32-C3","U1","QFN","1","LCSC","https://lcsc.com/product-detail/C2934560.html"',
			'"Cap, 1uF","C1","0603","1","",""',
		].join("\n")
		const k = parseBomCsv(kicad)
		check("bom-csv · the header is found below a commented preamble", k.header?.[0] === "Comment")
		check("bom-csv · a comma inside a quoted field stays in the name", k.lines[1]?.name === "Cap, 1uF")
		check("bom-csv · a part with no price still imports at zero", k.lines[1]?.unitCostUsd === 0)
		check("bom-csv · no currency means no link", k.lines[1]?.link === null)

		check("bom-csv · a file with no header imports nothing", parseBomCsv("a,b,c\n1,2,3").header === null)
		const capped = parseBomCsv(kicad, { limit: 1 })
		check(
			"bom-csv · the limit is reported rather than silently dropped",
			capped.lines.length === 1 && capped.skipped.some((s) => s.reason === "beyond the parts-list limit"),
		)
	}

	/* ── 6bbb. The landing page's week-1 countdown ──────────────────────────── */
	//
	// The countdown is the one place a wrong number is visible to every visitor, and the arithmetic is the only part of it that can silently be wrong – the clock and the markup are not worth pinning. A span carries down the units rather than being recomputed from the total, so 90 minutes is 1h 30m and never 1h 90m; a moment already past clamps to zero rather than counting negative.
	const { countdownParts } = await import("../src/lib/site/countdown")
	{
		const DAY = 24 * 60 * 60 * 1000
		const HOUR = 60 * 60 * 1000
		const MIN = 60 * 1000

		check(
			"countdown · a full span splits into its units",
			JSON.stringify(countdownParts(3 * DAY + 9 * HOUR + 37 * MIN + 11 * 1000)) ===
				JSON.stringify({ days: 3, hours: 9, minutes: 37, seconds: 11 }),
		)
		check(
			"countdown · minutes carry into hours",
			JSON.stringify(countdownParts(90 * MIN)) === JSON.stringify({ days: 0, hours: 1, minutes: 30, seconds: 0 }),
		)
		check(
			"countdown · seconds carry into minutes",
			JSON.stringify(countdownParts(61 * 1000)) === JSON.stringify({ days: 0, hours: 0, minutes: 1, seconds: 1 }),
		)
		check(
			"countdown · a past moment clamps to zero",
			JSON.stringify(countdownParts(-5000)) === JSON.stringify({ days: 0, hours: 0, minutes: 0, seconds: 0 }),
		)
		check(
			"countdown · a non-finite span is all zeroes",
			JSON.stringify(countdownParts(Number.NaN)) === JSON.stringify({ days: 0, hours: 0, minutes: 0, seconds: 0 }),
		)
		check(
			"countdown · the remainder is floored, not rounded up",
			countdownParts(59_999).seconds === 59 && countdownParts(59_999).minutes === 0,
		)
	}

	/* ── 6c. Repo references, across forges ─────────────────────────────────── */
	//
	// Three shapes reach the sync and all have to work. `githubRepo` on a project is a full URL; `repoSyncRepo` – the repo the sync is pinned to – is a full URL now too, but a row written before that change holds a bare `owner/name` with no host. They went through one parser that assumed a URL, so `new URL("owner/name")` read `owner` as the HOSTNAME, never matched github.com, and refused every enable with "Pick a GitHub repo". The bare form is now resolved against a named forge (the caller's), and both forms are pinned here so the columns cannot drift apart again.
	//
	// GitLab is a forge we speak now, so `gitlab.com/a/b` PARSES rather than being refused – the old expectation. What is refused is a host we do not know (Codeberg, self-hosted Gitea), which the checks warn about rather than block on.
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
			// A bare slug can only resolve against a named forge: `Heliodex/coputer has no host to tell GitHub from GitLab, so the caller supplies the one the sync was pinned under.
			const parsed = parseRepoRef(input, { forge: FORGES.github })
			check(
				`repo-ref · ${label} parses`,
				parsed !== null && parsed.fullName === expected && parsed.forge.id === forgeId,
				parsed ? `${parsed.forge.id}:${parsed.fullName}` : "null",
			)
		}

		// A bare slug with no forge named is genuinely ambiguous and must be refused rather than guessed at.
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
