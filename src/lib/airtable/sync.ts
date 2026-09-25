import "server-only"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { fieldKey, toFields, YSWS_PENDING_REVIEW, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { deleteUnifiedRecords, deleteYswsRecord, writeYswsRecord } from "@/lib/airtable/ysws"
import { getThemeDef } from "@/lib/config/program"
import { syncHcaProfile } from "@/lib/hca-profile"
import { getHoursBreakdown } from "@/lib/hours"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { decryptUserPII } from "@/lib/pii"
import prisma from "@/lib/prisma"
import { getProgramSettings } from "@/lib/program"
import { findRepoFile, parseGitHubRepo } from "@/lib/repo-checks"
import { publicUrlFor } from "@/lib/uploads/r2"

/**
 * One handed-in (themed project, phase) → one row in `YSWS Project
 * Submission`, written at submit as "Pending Review".
 *
 * Half Life has no review page of its own: reviewers work on
 * ari.hackclub.com, straight from this table. So the row is the submission,
 * and everything a reviewer needs to judge it goes into it here — the repo,
 * the hours, the timelapses, the parts money, the address to ship to.
 */

const round2 = (n: number) => Math.round(n * 100) / 100

/** YYYY-MM-DD, in UTC — the program's week maths is UTC-anchored too. */
const ymd = (d: Date) => d.toISOString().slice(0, 10)

/**
 * The record id this (project, phase) was last written to, or null.
 *
 * Kept in the audit row each successful write leaves (see trackSideEffect),
 * because the table has no column of ours to find the row by. A later
 * "removed" entry means the row was deleted on unsubmit, so the next
 * submission starts a fresh one.
 */
async function lastRecordId(themeProjectId: string, phase: Phase): Promise<string | null> {
  const rows = await prisma.auditLog.findMany({
    where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: themeProjectId },
    orderBy: { createdAt: "desc" },
    select: { metadata: true },
    take: 50,
  })
  for (const row of rows) {
    const meta = row.metadata as { phase?: string; recordId?: string; removed?: boolean } | null
    if (meta?.phase !== phase) continue
    if (meta.removed) return null
    if (typeof meta.recordId === "string") return meta.recordId
  }
  return null
}

/** The fields for this submission, exactly as the table names them. */
async function fieldsFor(themeProjectId: string, phase: Phase) {
  const project = await prisma.themeProject.findUnique({
    where: { id: themeProjectId },
    include: {
      bomItems: { select: { quantity: true, unitCostUsd: true } },
      workSessions: {
        where: { phase, deletedAt: null },
        select: {
          timelapses: { select: { provider: true, externalId: true, playbackUrl: true, objectKey: true } },
        },
      },
      hackatimeLinks: { where: { phase }, select: { hackatimeProject: true } },
    },
  })
  if (!project) return null

  // Fresh from HCA, so the address a grant ships to is the one on file today
  // rather than the one from whenever they last signed in.
  await syncHcaProfile(project.userId)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: project.userId } })
  const pii = decryptUserPII(user)

  const def = getThemeDef(project.theme)
  const week = phase === Phase.DESIGN ? def.designWeek : def.buildWeek
  const settings = await getProgramSettings()
  const weekStart = new Date(settings.eventStartDate.getTime() + (week - 1) * 7 * 86_400_000)
  const weekEnd = new Date(weekStart.getTime() + 6 * 86_400_000)

  const breakdown = await getHoursBreakdown(themeProjectId, phase)
  const bomTotal = round2(
    project.bomItems.reduce((n, l) => n + l.quantity * l.unitCostUsd, 0) + (project.bomTaxShippingUsd ?? 0),
  )

  // A design is judged from its repo; a build from the video of it working —
  // the closing reel the submit sheet asks for, posted under this week's key.
  let playableUrl = project.githubRepo ?? ""
  if (phase === Phase.BUILD) {
    const demo = await prisma.post.findFirst({
      where: {
        userId: project.userId,
        checkpointKey: `w${week}-reel-submission`,
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      select: { objectKey: true },
    })
    playableUrl = publicUrlFor(demo?.objectKey ?? null) ?? playableUrl
  }

  const lapseLinks = project.workSessions
    .flatMap((s) => s.timelapses)
    .map((t) =>
      t.provider === "lapse" && t.externalId
        ? lapseTimelapseUrl(t.externalId)
        : (t.playbackUrl ?? publicUrlFor(t.objectKey)),
    )
    .filter((u): u is string => !!u)

  const hackatime = project.hackatimeLinks.map((l) => `${l.hackatimeProject} (${ymd(weekStart)} to ${ymd(weekEnd)})`)

  const [firstName, ...rest] = (user.name ?? "").trim().split(/\s+/)
  const tier = project.tier ?? project.requestedTier
  const journalUrl = await findRepoFile(project.githubRepo, /(^|\/)journal\.md$/i)
  const cover = publicUrlFor(project.coverImageKey)

  const fields = toFields(YSWS_SUBMISSION.fields, {
    codeUrl: project.githubRepo ?? "",
    firstName: firstName ?? "",
    lastName: rest.join(" "),
    email: user.email,
    ...(pii.birthday ? { birthday: pii.birthday } : {}),
    slackId: user.slackId ?? "",
    stage: phase === Phase.DESIGN ? "Design" : "Build",
    // The parts are funded once, at design. A build asks for no new money, so
    // its row says $0 rather than repeating the design's request.
    requestedFunding: phase === Phase.DESIGN ? bomTotal : 0,
    hoursSelfReported: round2(breakdown.journalHoursClaimed + breakdown.hackatimeHours),
    playableUrl,
    description: project.description ?? "",
    journalUrl: journalUrl ?? "",
    lapseLinks: lapseLinks.join(", "),
    githubUsername: project.githubRepo ? (parseGitHubRepo(project.githubRepo)?.owner ?? "") : "",
    addressLine1: pii.line1 ?? "",
    addressLine2: pii.line2 ?? "",
    city: pii.city ?? "",
    zip: pii.zip ?? "",
    state: pii.state ?? "",
    country: pii.country ?? "",
    hackatimeProjects: hackatime.join(", "),
    hackatimeId: user.hackatimeUserId ?? "",
    projectName: project.title,
    reviewStatus: YSWS_PENDING_REVIEW,
    tier: tier ? `Tier ${tier}` : "",
  })
  // An attachment is written as a URL Airtable fetches, so the bytes stay in
  // R2 and the base only references them.
  if (cover) fields[fieldKey(YSWS_SUBMISSION.fields.screenshot)] = [{ url: cover }]
  return fields
}

/**
 * Write this submission's row: a new one the first time, the same one on a
 * re-submission, so a phase handed in twice is never two rows.
 */
export async function syncSubmissionToYsws(
  themeProjectId: string,
  phase: Phase,
): Promise<{ recordId: string; dropped: string[] } | { skipped: string }> {
  const settings = await getProgramSettings()
  if (!settings.airtableSyncEnabled) return { skipped: "sync_disabled" }
  const fields = await fieldsFor(themeProjectId, phase)
  if (!fields) return { skipped: "project_not_found" }
  return writeYswsRecord(fields, await lastRecordId(themeProjectId, phase))
}

/** Remove a submission's row, and its unified-base twin, when it is taken back. */
export async function removeSubmissionFromYsws(
  themeProjectId: string,
  phase: Phase,
): Promise<{ deleted: boolean; unifiedDeleted: string[]; skipped?: string }> {
  const recordId = await lastRecordId(themeProjectId, phase)
  if (!recordId) return { deleted: false, unifiedDeleted: [], skipped: "no_row" }
  const local = await deleteYswsRecord(recordId)
  if (!local.unifiedRecordId) return { deleted: local.deleted, unifiedDeleted: [], skipped: local.skipped }
  const unified = await deleteUnifiedRecords([local.unifiedRecordId])
  return { deleted: local.deleted, unifiedDeleted: unified.deleted, skipped: unified.skipped }
}

/**
 * Submissions awaiting review whose row never made it to the table — a write
 * that failed, or one made before this sync existed. Replayed by the retry
 * job and listed on /admin/program.
 */
export async function findUnsyncedSubmissions(): Promise<{ themeProjectId: string; phase: Phase }[]> {
  const pending = await prisma.themeProject.findMany({
    where: {
      deletedAt: null,
      OR: [{ designStatus: PhaseStatus.in_review }, { buildStatus: PhaseStatus.in_review }],
    },
    select: {
      id: true,
      designStatus: true,
      buildStatus: true,
      submissions: { orderBy: { createdAt: "desc" }, select: { phase: true, createdAt: true } },
    },
  })
  if (pending.length === 0) return []

  const synced = await prisma.auditLog.findMany({
    where: { action: "AIRTABLE_SYNC_SUCCESS", targetId: { in: pending.map((p) => p.id) } },
    select: { targetId: true, createdAt: true, metadata: true },
  })

  const out: { themeProjectId: string; phase: Phase }[] = []
  for (const p of pending) {
    for (const phase of [Phase.DESIGN, Phase.BUILD] as const) {
      const status = phase === Phase.DESIGN ? p.designStatus : p.buildStatus
      if (status !== PhaseStatus.in_review) continue
      const submittedAt = p.submissions.find((s) => s.phase === phase)?.createdAt
      // Written since the latest hand-in counts; an older write was for a
      // submission that has since been taken back and handed in again.
      const written = synced.some((s) => {
        const meta = s.metadata as { phase?: string; recordId?: string } | null
        return (
          s.targetId === p.id &&
          meta?.phase === phase &&
          typeof meta.recordId === "string" &&
          (!submittedAt || s.createdAt >= submittedAt)
        )
      })
      if (!written) out.push({ themeProjectId: p.id, phase })
    }
  }
  return out
}
