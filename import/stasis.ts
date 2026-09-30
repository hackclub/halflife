/**
 * Import a sibling Hack Club programme's hardware data into Half Life.
 *
 * The source (Stasis/Siege lineage) is read-only; the target is whatever
 * Half Life's DATABASE_URL points at. Run it against a scratch database, not
 * production:
 *
 *   pnpm exec tsx import/stasis.ts                 # everything
 *   pnpm exec tsx import/stasis.ts --limit=50      # first 50 users (quick pass)
 *   pnpm exec tsx import/stasis.ts --dry-run       # count, write nothing
 *   pnpm exec tsx import/stasis.ts --keep-emails   # keep real addresses
 *
 * Shape differences this bridges:
 *   - Half Life is theme-based (one project per user per theme, five themes).
 *     The source is unthemed, so each user's projects are assigned themes in
 *     creation order and anything past the fifth is dropped.
 *   - The source stores full asset URLs; Half Life stores object keys. Imported
 *     rows keep the URL and `publicUrlFor` passes absolute URLs through.
 *   - The source has no two-pot economy, so every imported transaction lands in
 *     the SPENDABLE pot.
 *   - PII: emails are anonymised unless --keep-emails, encrypted columns are
 *     never read, and third-party ids that would collide with an existing row
 *     are dropped rather than failing the import.
 */
import { config } from "dotenv"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  CoinBucket,
  HoursSource,
  LedgerKind,
  MediaType,
  Phase,
  PhaseStatus,
  ReviewPass,
  ReviewResult,
  Role,
  ShopItemCategory,
  ShopOrderStatus,
  Theme,
} from "@/app/generated/prisma/enums"
import { PrismaClient, type Prisma } from "@/app/generated/prisma/client"
import { DEFAULT_PROGRAM_TIMEZONE, scheduledWeekFor } from "@/lib/config/program"
import { getTierOrThrow } from "@/lib/config/tiers"

config({ path: "import/.env" })
config()

const SOURCE_URL = process.env.DB_URL
const TARGET_URL = process.env.DATABASE_URL
if (!SOURCE_URL) throw new Error("DB_URL missing from import/.env")
if (!TARGET_URL) throw new Error("DATABASE_URL missing — copy .env.example to .env")

const args = process.argv.slice(2)
const has = (f: string) => args.includes(`--${f}`)
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0") || Infinity
const KEEP_EMAILS = has("keep-emails")
const DRY = has("dry-run")

const source = new PrismaClient({ adapter: new PrismaPg({ connectionString: SOURCE_URL }) })
const target = new PrismaClient({ adapter: new PrismaPg({ connectionString: TARGET_URL }) })

const BATCH = 1000
const THEME_ORDER = [Theme.PCB, Theme.CAD, Theme.SYNTH, Theme.DISPLAYS, Theme.BREADBOARD_COMPUTER]

async function insert<T>(label: string, rows: T[], run: (batch: T[]) => Promise<number>): Promise<number> {
  if (DRY || rows.length === 0) {
    console.log(`  ${label}: ${rows.length}${DRY ? " (dry run)" : ""}`)
    return rows.length
  }
  let n = 0
  for (let i = 0; i < rows.length; i += BATCH) n += await run(rows.slice(i, i + BATCH))
  console.log(`  ${label}: ${n}/${rows.length}`)
  return n
}

const read = <T>(sql: string) => source.$queryRawUnsafe<T[]>(sql)

/** YYYY-MM-DD in a timezone, matching lib/program.effectiveDateFor. */
function effectiveDateFor(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date)
}

interface SourceUser {
  id: string
  email: string
  name: string | null
  image: string | null
  emailVerified: boolean
  slackId: string | null
  slackDisplayName: string | null
  hackatimeUserId: string | null
  verificationStatus: string | null
  bio: string | null
  pronouns: string | null
  timezone: string | null
  fraudConvicted: boolean
  createdAt: Date
  updatedAt: Date
  submissionExtensionUntil: Date | null
}

interface SourceProject {
  id: string
  userId: string
  title: string
  description: string | null
  githubRepo: string | null
  coverImage: string | null
  starterProjectId: string | null
  tier: number | null
  requestedAmount: number | null
  designStatus: PhaseStatus
  designReviewComments: string | null
  designReviewedAt: Date | null
  designReviewedBy: string | null
  buildStatus: PhaseStatus
  buildReviewComments: string | null
  buildReviewedAt: Date | null
  buildReviewedBy: string | null
  cartScreenshots: string[]
  bomShipping: number | null
  bomTax: number | null
  submissionExtensionUntil: Date | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
  deletedById: string | null
}

interface SourceSession {
  id: string
  projectId: string
  stage: Phase
  title: string
  content: string | null
  hoursClaimed: number
  hoursApproved: number | null
  reviewedAt: Date | null
  reviewedBy: string | null
  createdAt: Date
  effectiveDate: string | null
}

interface SourceMedia {
  id: string
  workSessionId: string
  type: MediaType
  url: string
  createdAt: Date
}

interface SourceTimelapse {
  id: string
  workSessionId: string
  timelapseId: string
  playbackUrl: string | null
  thumbnailUrl: string | null
  duration: number | null
}

interface SourceBom {
  id: string
  projectId: string
  name: string
  purpose: string | null
  quantity: number | null
  costPerItem: number | null
  distributor: string | null
  link: string | null
  createdAt: Date
}

interface SourceHackatime {
  id: string
  projectId: string
  hackatimeProject: string
  hoursApproved: number | null
  reviewedAt: Date | null
  reviewedBy: string | null
  createdAt: Date
}

interface SourceSubmission {
  id: string
  projectId: string
  stage: Phase
  notes: string | null
  preReviewed: boolean
  createdAt: Date
}

interface SourceReview {
  id: string
  submissionId: string
  reviewerId: string
  result: ReviewResult
  feedback: string
  reason: string | null
  invalidated: boolean
  workUnitsOverride: number | null
  tierOverride: number | null
  grantOverride: number | null
  frozenWorkUnits: number | null
  frozenEntryCount: number | null
  frozenFundingAmount: number | null
  frozenTier: number | null
  createdAt: Date
}

interface SourceTransaction {
  id: string
  userId: string
  projectId: string | null
  amount: number
  type: string
  note: string | null
  balanceBefore: number
  balanceAfter: number
  createdBy: string | null
  createdAt: Date
}

interface SourceShopItem {
  id: string
  name: string
  description: string
  imageUrl: string | null
  price: number
  active: boolean
  sortOrder: number
  maxPerUser: number
}

interface SourceShopOrder {
  id: string
  userId: string
  shopItemId: string
  quantity: number
  unitBitsCost: number
  totalBitsCost: number
  estimatedUsdCents: number
  status: ShopOrderStatus
  trackingNumber: string | null
  trackingCarrier: string | null
  holdReason: string | null
  rejectionReason: string | null
  placedAt: Date
  heldAt: Date | null
  rejectedAt: Date | null
  fulfilledAt: Date | null
  lastActorId: string | null
}

const LEDGER_KIND: Record<string, LedgerKind> = {
  PROJECT_APPROVED: LedgerKind.BUILD_HOURS,
  PROJECT_APPROVED_REVERSED: LedgerKind.BUILD_HOURS,
  DESIGN_APPROVED: LedgerKind.DESIGN_EXCESS_HOURS,
  DESIGN_APPROVED_REVERSED: LedgerKind.DESIGN_EXCESS_HOURS,
  ADMIN_GRANT: LedgerKind.ADMIN_ADJUSTMENT,
  ADMIN_DEDUCTION: LedgerKind.ADMIN_ADJUSTMENT,
  REVIEWER_PAYMENT: LedgerKind.REVIEWER_PAYMENT,
  SHOP_PURCHASE: LedgerKind.SHOP_PURCHASE,
  SHOP_REFUND: LedgerKind.SHOP_REFUND,
  SHOP_REFUND_REVERSED: LedgerKind.SHOP_REFUND,
}

const ROLE_MAP: Record<string, Role> = {
  ADMIN: Role.ADMIN,
  REVIEWER: Role.REVIEWER,
  AUDITOR: Role.AUDITOR,
  SIDEKICK: Role.REVIEWER,
}

async function importUsers(): Promise<{
  ids: Set<string>
  reviewerIds: Set<string>
}> {
  const existing = await target.user.findMany({
    select: { id: true, email: true, slackId: true, hackatimeUserId: true },
  })
  const takenSlack = new Set(existing.map((u) => u.slackId).filter((v): v is string => !!v))
  const takenHackatime = new Set(existing.map((u) => u.hackatimeUserId).filter((v): v is string => !!v))

  const users = await read<SourceUser>(`SELECT * FROM "user" ORDER BY "createdAt"`)
  const limited = users.slice(0, LIMIT)
  const rows: Prisma.UserCreateManyInput[] = []
  const ids = new Set<string>()

  for (const u of limited) {
    ids.add(u.id)
    const slackId = u.slackId && !takenSlack.has(u.slackId) ? u.slackId : null
    if (slackId) takenSlack.add(slackId)
    const hackatimeUserId =
      u.hackatimeUserId && !takenHackatime.has(u.hackatimeUserId) ? u.hackatimeUserId : null
    if (hackatimeUserId) takenHackatime.add(hackatimeUserId)
    rows.push({
      id: u.id,
      email: KEEP_EMAILS ? u.email : `imported+${u.id.toLowerCase()}@halflife.test`,
      name: u.name,
      image: u.image,
      emailVerified: u.emailVerified,
      slackId,
      slackDisplayName: u.slackDisplayName,
      hackatimeUserId,
      verificationStatus: u.verificationStatus ?? "verified",
      bio: u.bio,
      pronouns: u.pronouns,
      timezone: u.timezone,
      fraudFlagged: u.fraudConvicted,
      joinedProgramAt: u.createdAt,
      onboardingCompletedAt: u.createdAt,
      submissionExtensionUntil: u.submissionExtensionUntil,
      createdAt: u.createdAt,
    })
  }

  await insert("users", rows, (b) => target.user.createMany({ data: b, skipDuplicates: true }).then((r) => r.count))

  // Roles, so the review console has staff to exercise it with.
  const sourceRoles = await read<{ id: string; userId: string; role: string; grantedAt: Date; grantedBy: string | null }>(
    `SELECT * FROM user_role`,
  )
  const roleRows: Prisma.UserRoleCreateManyInput[] = []
  for (const r of sourceRoles) {
    const role = ROLE_MAP[r.role]
    if (!role || !ids.has(r.userId)) continue
    roleRows.push({ id: r.id, userId: r.userId, role, grantedAt: r.grantedAt, grantedBy: r.grantedBy })
  }
  await insert("user roles", roleRows, (b) =>
    target.userRole.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )

  const reviewerIds = new Set(roleRows.map((r) => r.userId))
  return { ids, reviewerIds }
}

async function importProjects(userIds: Set<string>): Promise<{
  ids: Set<string>
  userIdOf: Map<string, string>
  themeOf: Map<string, Theme>
}> {
  const projects = await read<SourceProject>(`SELECT * FROM project WHERE "deletedAt" IS NULL ORDER BY "userId", "createdAt"`)
  const byUser = new Map<string, SourceProject[]>()
  for (const p of projects) {
    if (!userIds.has(p.userId)) continue
    const list = byUser.get(p.userId) ?? []
    list.push(p)
    byUser.set(p.userId, list)
  }

  const rows: Prisma.ThemeProjectCreateManyInput[] = []
  const ids = new Set<string>()
  const userIdOf = new Map<string, string>()
  const themeOf = new Map<string, Theme>()
  let dropped = 0

  for (const [userId, list] of byUser) {
    list.slice(0, 5).forEach((p, i) => {
      const theme = THEME_ORDER[i]!
      const tier = p.tier && p.tier >= 1 && p.tier <= 3 ? p.tier : null
      ids.add(p.id)
      userIdOf.set(p.id, userId)
      themeOf.set(p.id, theme)
      rows.push({
        id: p.id,
        userId,
        theme,
        title: p.title,
        description: p.description,
        coverImageKey: p.coverImage,
        githubRepo: p.githubRepo,
        designStatus: p.designStatus,
        designReviewComments: p.designReviewComments,
        designReviewedAt: p.designReviewedAt,
        designReviewedById: p.designReviewedBy,
        buildStatus: p.buildStatus,
        buildReviewComments: p.buildReviewComments,
        buildReviewedAt: p.buildReviewedAt,
        buildReviewedById: p.buildReviewedBy,
        tier,
        grantUsd: tier ? getTierOrThrow(tier).grantUsd : null,
        requestedTier: tier,
        starterProjectId: p.starterProjectId,
        bomTaxShippingUsd: (p.bomShipping ?? 0) + (p.bomTax ?? 0) || null,
        namedAt: p.createdAt,
        submissionExtensionUntil: p.submissionExtensionUntil,
        createdAt: p.createdAt,
        deletedAt: p.deletedAt,
        deletedById: p.deletedById,
      })
    })
    dropped += Math.max(0, list.length - 5)
  }
  if (dropped > 0) console.log(`  (dropped ${dropped} projects past each user's fifth theme slot)`)

  await insert("projects", rows, (b) =>
    target.themeProject.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
  return { ids, userIdOf, themeOf }
}

async function importSessions(
  projectIds: Set<string>,
  themeOf: Map<string, Theme>,
): Promise<{ ids: Set<string>; sessions: SourceSession[] }> {
  const all = await read<SourceSession>(`SELECT * FROM work_session ORDER BY "createdAt"`)
  const sessions = all.filter((s) => projectIds.has(s.projectId))

  const rows: Prisma.WorkSessionCreateManyInput[] = sessions.map((s) => {
    const theme = themeOf.get(s.projectId)!
    const week = scheduledWeekFor(theme, s.stage)
    return {
      id: s.id,
      themeProjectId: s.projectId,
      phase: s.stage,
      title: s.title,
      content: s.content,
      hoursClaimed: s.hoursClaimed ?? 0,
      hoursApproved: s.hoursApproved,
      hoursSource: HoursSource.MANUAL,
      weekNumber: week,
      effectiveDate: s.effectiveDate ?? effectiveDateFor(s.createdAt, DEFAULT_PROGRAM_TIMEZONE),
      reviewComments: null,
      reviewedAt: s.reviewedAt,
      reviewedById: s.reviewedBy,
      createdAt: s.createdAt,
    }
  })

  await insert("work sessions", rows, (b) =>
    target.workSession.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
  return { ids: new Set(sessions.map((s) => s.id)), sessions }
}

async function importMedia(sessionIds: Set<string>): Promise<void> {
  const all = await read<SourceMedia>(`SELECT * FROM session_media ORDER BY "createdAt"`)
  const rows: Prisma.SessionMediaCreateManyInput[] = all
    .filter((m) => sessionIds.has(m.workSessionId))
    .map((m) => ({
      id: m.id,
      workSessionId: m.workSessionId,
      type: m.type,
      // The source asset host, kept whole; lib/uploads/r2.publicUrlFor passes
      // an absolute URL through rather than prefixing the bucket base.
      objectKey: m.url,
      createdAt: m.createdAt,
    }))
  await insert("session media", rows, (b) =>
    target.sessionMedia.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
}

async function importTimelapses(sessionIds: Set<string>): Promise<void> {
  const all = await read<SourceTimelapse>(`SELECT * FROM session_timelapse ORDER BY "createdAt"`)
  const rows: Prisma.SessionTimelapseCreateManyInput[] = all
    .filter((t) => sessionIds.has(t.workSessionId))
    .map((t) => ({
      id: t.id,
      workSessionId: t.workSessionId,
      provider: "lapse",
      externalId: t.timelapseId,
      playbackUrl: t.playbackUrl,
      thumbnailUrl: t.thumbnailUrl,
      coveredSeconds: t.duration,
    }))
  await insert("session timelapses", rows, (b) =>
    target.sessionTimelapse.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
}

async function importBom(projectIds: Set<string>): Promise<void> {
  const all = await read<SourceBom>(`SELECT * FROM bom_item ORDER BY "createdAt"`)
  let sort = 0
  const rows: Prisma.BomItemCreateManyInput[] = all
    .filter((b) => projectIds.has(b.projectId))
    .map((b) => ({
      id: b.id,
      themeProjectId: b.projectId,
      name: b.name,
      purpose: b.purpose,
      quantity: b.quantity ?? 1,
      unitCostUsd: b.costPerItem ?? 0,
      vendor: b.distributor,
      link: b.link,
      sortOrder: sort++,
      createdAt: b.createdAt,
    }))
  await insert("bom items", rows, (b) =>
    target.bomItem.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
}

async function importHackatime(projectIds: Set<string>): Promise<void> {
  const all = await read<SourceHackatime>(`SELECT * FROM hackatime_project ORDER BY "createdAt"`)
  const rows: Prisma.HackatimeLinkCreateManyInput[] = all
    .filter((h) => projectIds.has(h.projectId))
    .map((h) => ({
      id: h.id,
      themeProjectId: h.projectId,
      hackatimeProject: h.hackatimeProject,
      phase: Phase.BUILD,
      hoursApproved: h.hoursApproved,
      reviewedAt: h.reviewedAt,
      reviewedById: h.reviewedBy,
      createdAt: h.createdAt,
    }))
  await insert("hackatime links", rows, (b) =>
    target.hackatimeLink.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
}

async function importSubmissions(
  projectIds: Set<string>,
  themeOf: Map<string, Theme>,
  cartScreenshots: Map<string, string[]>,
): Promise<Map<string, { phase: Phase; createdAt: Date }>> {
  const all = await read<SourceSubmission>(`SELECT * FROM project_submission ORDER BY "createdAt"`)
  const rows: Prisma.PhaseSubmissionCreateManyInput[] = all
    .filter((s) => projectIds.has(s.projectId))
    .map((s) => {
      const week = scheduledWeekFor(themeOf.get(s.projectId)!, s.stage)
      return {
        id: s.id,
        themeProjectId: s.projectId,
        phase: s.stage,
        notes: s.notes,
        // The design week asks for the cart screenshot, which the source kept
        // on the project rather than the submission.
        attachmentKeys: s.stage === Phase.DESIGN ? (cartScreenshots.get(s.projectId) ?? []) : [],
        submittedInWeek: week,
        scheduledWeek: week,
        onTime: true,
        preReviewed: s.preReviewed,
        createdAt: s.createdAt,
      }
    })
  await insert("submissions", rows, (b) =>
    target.phaseSubmission.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
  return new Map(
    all
      .filter((s) => projectIds.has(s.projectId))
      .map((s) => [s.id, { phase: s.stage, createdAt: s.createdAt }] as const),
  )
}

async function importReviews(
  submissionIds: Map<string, { phase: Phase; createdAt: Date }>,
  userIds: Set<string>,
): Promise<void> {
  const all = await read<SourceReview>(`SELECT * FROM submission_review ORDER BY "createdAt"`)
  const rows: Prisma.SubmissionReviewCreateManyInput[] = all
    .filter((r) => submissionIds.has(r.submissionId))
    .map((r) => ({
      id: r.id,
      submissionId: r.submissionId,
      // Null for a reviewer this import did not bring across.
      reviewerId: userIds.has(r.reviewerId) ? r.reviewerId : null,
      pass: ReviewPass.FINAL,
      result: r.result,
      feedback: r.feedback,
      reason: r.reason,
      invalidated: r.invalidated,
      hoursOverride: r.workUnitsOverride,
      tierOverride: r.tierOverride,
      grantUsdOverride: r.grantOverride,
      frozenApprovedHours: r.frozenWorkUnits,
      frozenEntryCount: r.frozenEntryCount,
      frozenGrantUsd: r.frozenFundingAmount,
      frozenTier: r.frozenTier,
      createdAt: r.createdAt,
    }))
  await insert("submission reviews", rows, (b) =>
    target.submissionReview.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )

  // Resolve each submission whose latest review decided it.
  if (!DRY) {
    const resolved = new Map<string, { at: Date; result: ReviewResult }>()
    for (const r of all) {
      if (!submissionIds.has(r.submissionId) || r.invalidated) continue
      const prev = resolved.get(r.submissionId)
      if (!prev || r.createdAt > prev.at) resolved.set(r.submissionId, { at: r.createdAt, result: r.result })
    }
    let n = 0
    for (const [submissionId, v] of resolved) {
      const res = await target.phaseSubmission.updateMany({
        where: { id: submissionId, resolvedAt: null },
        data: { resolvedAt: v.at, resolvedResult: v.result },
      })
      n += res.count
    }
    console.log(`  resolved submissions: ${n}`)
  }
}

async function importLedger(userIds: Set<string>, projectIds: Set<string>): Promise<void> {
  const all = await read<SourceTransaction>(`SELECT * FROM currency_transaction ORDER BY "createdAt"`)
  const rows: Prisma.LedgerEntryCreateManyInput[] = all
    .filter((t) => userIds.has(t.userId))
    .map((t) => ({
      id: t.id,
      userId: t.userId,
      kind: LEDGER_KIND[t.type] ?? LedgerKind.ADMIN_ADJUSTMENT,
      bucket: CoinBucket.SPENDABLE,
      amount: t.amount,
      note: t.note,
      themeProjectId: t.projectId && projectIds.has(t.projectId) ? t.projectId : null,
      createdById: t.createdBy && userIds.has(t.createdBy) ? t.createdBy : null,
      balanceBefore: t.balanceBefore,
      balanceAfter: t.balanceAfter,
      createdAt: t.createdAt,
    }))
  await insert("ledger entries", rows, (b) =>
    target.ledgerEntry.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )
}

async function importShop(userIds: Set<string>): Promise<void> {
  const items = await read<SourceShopItem>(`SELECT * FROM shop_item ORDER BY "sortOrder"`)
  const itemRows: Prisma.ShopItemCreateManyInput[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    imageUrl: i.imageUrl,
    // The source has no category; keeping them open (not printer-gated) makes
    // them usable in a test build.
    category: ShopItemCategory.MISC,
    priceCredits: i.price,
    maxPerUser: i.maxPerUser,
    requiresPrinterQualified: false,
    active: i.active,
    sortOrder: i.sortOrder,
  }))
  const itemIds = new Set(items.map((i) => i.id))
  await insert("shop items", itemRows, (b) =>
    target.shopItem.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )

  const orders = await read<SourceShopOrder>(`SELECT * FROM shop_order ORDER BY "placedAt"`)
  const orderRows: Prisma.ShopOrderCreateManyInput[] = orders
    .filter((o) => userIds.has(o.userId) && itemIds.has(o.shopItemId))
    .map((o) => ({
      id: o.id,
      userId: o.userId,
      shopItemId: o.shopItemId,
      quantity: o.quantity,
      unitCredits: o.unitBitsCost,
      totalCredits: o.totalBitsCost,
      itemNameSnapshot: items.find((i) => i.id === o.shopItemId)?.name ?? "Item",
      unitCostUsd: o.quantity > 0 ? o.estimatedUsdCents / 100 / o.quantity : null,
      status: o.status,
      holdReason: o.holdReason,
      rejectionReason: o.rejectionReason,
      trackingNumber: o.trackingNumber,
      trackingCarrier: o.trackingCarrier,
      placedAt: o.placedAt,
      heldAt: o.heldAt,
      rejectedAt: o.rejectedAt,
      fulfilledAt: o.fulfilledAt,
      lastActorId: o.lastActorId,
    }))
  await insert("shop orders", orderRows, (b) =>
    target.shopOrder.createMany({ data: b, skipDuplicates: true }).then((r) => r.count),
  )

  if (!DRY) {
    const paid = await target.ledgerEntry.count({ where: { kind: LedgerKind.SHOP_PURCHASE, shopOrderId: null } })
    console.log(`  (${paid} imported shop-purchase ledger rows keep shopOrderId null to avoid the unique key)`)
  }
}

async function main() {
  const started = Date.now()
  console.log(`Source: ${SOURCE_URL!.replace(/:[^:@/]+@/, ":***@")}`)
  console.log(`Target: ${TARGET_URL!.replace(/:[^:@/]+@/, ":***@")}`)
  if (DRY) console.log("DRY RUN — nothing will be written")
  if (KEEP_EMAILS) console.log("Keeping real email addresses")

  console.log("\nUsers")
  const { ids: userIds, reviewerIds } = await importUsers()
  console.log(`  reviewers: ${reviewerIds.size}`)
  if (userIds.size === 0) throw new Error("no users to import")

  console.log("\nProjects")
  const { ids: projectIds, themeOf } = await importProjects(userIds)

  console.log("\nJournals")
  const { ids: sessionIds } = await importSessions(projectIds, themeOf)
  await importMedia(sessionIds)
  await importTimelapses(sessionIds)

  console.log("\nParts and hours links")
  await importBom(projectIds)
  await importHackatime(projectIds)

  console.log("\nSubmissions and reviews")
  const cartScreenshots = new Map<string, string[]>()
  for (const p of await read<SourceProject>(`SELECT id, "cartScreenshots" FROM project`)) {
    if (p.cartScreenshots?.length) cartScreenshots.set(p.id, p.cartScreenshots)
  }
  const submissionIds = await importSubmissions(projectIds, themeOf, cartScreenshots)
  await importReviews(submissionIds, userIds)

  console.log("\nCredit")
  await importLedger(userIds, projectIds)

  console.log("\nShop")
  await importShop(userIds)

  console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await source.$disconnect()
    await target.$disconnect()
  })
