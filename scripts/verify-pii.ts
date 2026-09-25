import "dotenv/config"
import { createHmac, randomBytes } from "node:crypto"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../src/app/generated/prisma/client"
import { Phase, PostKind, PostStatus, Role, Theme } from "../src/app/generated/prisma/enums"

/**
 * Does anything private reach a browser that should not have it?
 *
 * Asked against a RUNNING SERVER rather than by reading code, because the
 * dangerous paths are the ones inspection misses. A React Server Component
 * serialises whatever it hands a client component into the HTML, so a field
 * nobody renders can still ship; and `include: { user: true }` pulls every
 * column including the encrypted ones without naming a single one.
 *
 *   1. Two participants exist with sentinel values in every sensitive column.
 *      Signed in as one, no page and no API response may contain the other's
 *      email, Slack id, address, phone or birthday — nor, for the encrypted
 *      columns, the viewer's own. `/api/me` returning the viewer's OWN email
 *      and Slack id is expected and allowed: that is the endpoint's whole job.
 *
 *   2. A participant holding no role is refused by every staff surface. A 503
 *      counts as refused: an unconfigured integration endpoint fails closed,
 *      which is the designed behaviour rather than a hole.
 *
 * Sentinels rather than real ciphertext, because the question is whether a
 * COLUMN VALUE escapes, which does not depend on the encryption working.
 *
 * Needs the dev server on :3000 and a scratch database.
 * Run with `pnpm verify:pii`.
 */

const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000"

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
})

let failures = 0
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `: ${detail}`}`)
}

const S = {
  viewerEmail: "viewer-SENTINELEMAIL@example.test",
  otherEmail: "other-SENTINELEMAIL@example.test",
  viewerSlack: "USENTINELSLACKA",
  otherSlack: "USENTINELSLACKB",
  address: "SENTINELSTREET",
  phone: "SENTINELPHONE",
  birthday: "SENTINELBIRTHDAY",
  probeEmail: "authz-SENTINEL@example.test",
}

async function makeUser(email: string, name: string, slackId: string) {
  return prisma.user.create({
    data: {
      email,
      name,
      slackId,
      verificationStatus: "verified",
      joinedProgramAt: new Date(),
      onboardingCompletedAt: new Date(),
      encryptedAddressStreet: S.address,
      encryptedAddressCity: S.address,
      encryptedPhone: S.phone,
      encryptedBirthday: S.birthday,
    },
  })
}

async function cookieFor(userId: string): Promise<string> {
  const token = randomBytes(32).toString("hex")
  await prisma.session.create({
    data: {
      id: randomBytes(16).toString("hex"),
      token,
      userId,
      expiresAt: new Date(Date.now() + 864e5),
    },
  })
  const sig = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(token).digest("base64")
  return `better-auth.session_token=${token}.${sig}`
}

/** Surfaces a participant is signed in for. */
const PARTICIPANT_PAGES = ["/", "/explore", "/reels", "/doomscroller", "/shop", "/projects", "/docs"]
const PARTICIPANT_APIS = ["/api/feed", "/api/me", "/api/shop/items", "/api/program", "/api/projects"]

/** Everything that shows another person's data or moves money. */
const STAFF_SURFACES: [string, string][] = [
  ["GET", "/admin"],
  ["GET", "/admin/users"],
  ["GET", "/admin/audit"],
  ["GET", "/admin/feed"],
  ["GET", "/admin/fulfillment"],
  ["GET", "/review"],
  ["GET", "/api/admin/users"],
  ["GET", "/api/admin/audit"],
  ["GET", "/api/admin/shop/orders"],
  ["GET", "/api/review/queue"],
  ["GET", "/api/integrations/export/participants"],
  ["POST", "/api/admin/credits"],
  ["POST", "/api/admin/shop/items"],
]

async function main() {
  const { ensureThemeProject } = await import("../src/lib/provisioning")
  const { THEMES } = await import("../src/lib/config/program")

  for (const email of [S.viewerEmail, S.otherEmail, S.probeEmail]) {
    await prisma.user.deleteMany({ where: { email } })
  }

  const viewer = await makeUser(S.viewerEmail, "Viewer Person", S.viewerSlack)
  const other = await makeUser(S.otherEmail, "Other Person", S.otherSlack)
  // Fixtures: every theme's project, as if each checkpoint had been opened.
  for (const u of [viewer, other]) for (const t of THEMES) await ensureThemeProject(u.id, t.id)

  // The other participant needs work, or they appear on none of these pages and
  // the whole exercise passes by having nothing to leak.
  const project = await prisma.themeProject.findFirstOrThrow({
    where: { userId: other.id, theme: Theme.PCB },
  })
  await prisma.themeProject.update({
    where: { id: project.id },
    data: { title: "Other's board", description: "Theirs.", requestedTier: 1 },
  })
  await prisma.workSession.create({
    data: {
      themeProjectId: project.id,
      phase: Phase.DESIGN,
      title: "Their session",
      content: "Their journal entry, long enough to render.",
      hoursClaimed: 4,
      effectiveDate: new Date().toISOString().slice(0, 10),
    },
  })
  await prisma.post.create({
    data: {
      userId: other.id,
      themeProjectId: project.id,
      kind: PostKind.PROGRESS,
      caption: "their reel",
      objectKey: `posts/${other.id}/x.mp4`,
      checkpointKey: "w1-reel-1",
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  })

  const cookie = await cookieFor(viewer.id)

  // `/api/me` is the viewer asking about themselves, so their own identifiers
  // are the answer. Nobody else's, and no encrypted column, anywhere.
  const forbidden = (path: string): [string, string][] => [
    ["another participant's email", S.otherEmail],
    ["another participant's Slack id", S.otherSlack],
    ["an address column", S.address],
    ["a phone column", S.phone],
    ["a birthday column", S.birthday],
    ...(path === "/api/me"
      ? []
      : ([
          ["the viewer's own email", S.viewerEmail],
          ["the viewer's own Slack id", S.viewerSlack],
        ] as [string, string][])),
  ]

  for (const path of [...PARTICIPANT_PAGES, ...PARTICIPANT_APIS]) {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie } })
    const text = await res.text()
    const found = forbidden(path)
      .filter(([, needle]) => text.includes(needle))
      .map(([label]) => label)
    check(`${path} leaks nothing`, found.length === 0, found.join(", "))
  }

  // ── Staff surfaces, as somebody with no role at all ──────────────────────
  const nobody = await prisma.user.create({
    data: {
      email: S.probeEmail,
      name: "Ordinary",
      verificationStatus: "verified",
      joinedProgramAt: new Date(),
    },
  })
  const theirCookie = await cookieFor(nobody.id)

  for (const [method, path] of STAFF_SURFACES) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie: theirCookie, "content-type": "application/json" },
      ...(method === "POST" ? { body: "{}" } : {}),
      redirect: "manual",
    })
    const text = await res.text()
    const refused =
      [401, 403, 404, 503].includes(res.status) ||
      (res.status >= 300 && res.status < 400) ||
      text.includes("/login")
    check(`${method} ${path} refuses a participant`, refused, `got ${res.status}`)
  }

  // A sanity check on the checker: ADMIN must actually get in, or every line
  // above passes for the boring reason that nothing works.
  await prisma.userRole.create({ data: { userId: nobody.id, role: Role.ADMIN } })
  const asAdmin = await fetch(`${BASE}/api/admin/users`, { headers: { cookie: theirCookie } })
  check("and lets an ADMIN through", asAdmin.status === 200, `got ${asAdmin.status}`)

  await prisma.user.delete({ where: { id: viewer.id } })
  await prisma.user.delete({ where: { id: other.id } })
  await prisma.user.delete({ where: { id: nobody.id } })

  console.log(failures === 0 ? "\nAll PII checks passed." : `\n${failures} check(s) failed.`)
  process.exitCode = failures === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
