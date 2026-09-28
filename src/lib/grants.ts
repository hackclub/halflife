import "server-only"
import { type Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { isHcbConfigured, memoTransaction, parseGrantHashid, topUpCardGrant } from "@/lib/hcb"
import prisma from "@/lib/prisma"

/**
 * Send a participant's parts grant to their HCB card grant.
 *
 * Half Life's design approval is what decides the money (`grantUsd`, frozen at
 * approval), and this is the manual way to move it. It is deliberately careful:
 *
 *   - one top-up per (user, project, design), enforced by a unique row;
 *   - the row is written before HCB is called and marked `sentAt` after, so a
 *     crash or a failed call is recoverable rather than silently retried;
 *   - a failed attempt records its error and may be retried; one still in
 *     flight may not.
 *
 * Enabling this alongside the Airtable/YSWS payout pipeline would pay twice —
 * that ownership question is a decision, not something this code can settle.
 */

export interface SendGrantInput {
  themeProjectId: string
  phase: Phase
  /** The HCB grant link (or bare hashid) an admin pasted. */
  grantUrl: string
  adminId: string
  adminEmail: string | null
}

export interface SendGrantResult {
  amountCents: number
  transactionId: string | null
  /** True when a grant had already been sent for this project and phase. */
  alreadySent: boolean
}

export async function sendGrant(input: SendGrantInput): Promise<SendGrantResult> {
  if (!isHcbConfigured()) throw new HttpError("NOT_CONFIGURED", "HCB is not configured on this deployment")

  const hashid = parseGrantHashid(input.grantUrl)
  if (!hashid) throw new HttpError("VALIDATION_FAILED", "That is not an HCB grant link")

  const project = await prisma.themeProject.findFirst({
    where: { id: input.themeProjectId, deletedAt: null },
    select: { id: true, userId: true, title: true, theme: true, tier: true, grantUsd: true, designStatus: true },
  })
  if (!project) throw new HttpError("NOT_FOUND", "Project not found")
  if (project.designStatus !== PhaseStatus.approved || !project.grantUsd) {
    throw new HttpError("CONFLICT", "A grant is only due on an approved design")
  }
  const amountCents = Math.round(project.grantUsd * 100)

  const key = { userId: project.userId, themeProjectId: project.id, phase: input.phase }

  // Claim the slot before HCB is called, so two clicks cannot both send.
  let rowId: string
  try {
    const created = await prisma.hcbGrantTopUp.create({
      data: { ...key, grantHashid: hashid, amountCents, createdById: input.adminId },
      select: { id: true },
    })
    rowId = created.id
  } catch {
    const existing = await prisma.hcbGrantTopUp.findUnique({ where: { userId_themeProjectId_phase: key } })
    if (!existing) throw new HttpError("CONFLICT", "Could not start the grant")
    if (existing.sentAt) {
      return { amountCents: existing.amountCents, transactionId: existing.transactionId, alreadySent: true }
    }
    // A failed attempt (error set) may be retried; one still in flight (error
    // null) may not. The conditional update decides which this is.
    const reclaimed = await prisma.hcbGrantTopUp.updateMany({
      where: { id: existing.id, sentAt: null, error: { not: null } },
      data: { grantHashid: hashid, amountCents, error: null, createdById: input.adminId },
    })
    if (reclaimed.count === 0) throw new HttpError("CONFLICT", "A grant for this project is already being sent")
    rowId = existing.id
  }

  try {
    const { transactionId } = await topUpCardGrant(hashid, amountCents)
    if (transactionId) {
      const memo = `[grant] ${project.title || "Half Life project"} — Half Life tier ${project.tier ?? "?"}`
      await memoTransaction(transactionId, memo).catch((err) => console.warn("[hcb] memo failed:", err))
    }
    await prisma.hcbGrantTopUp.update({ where: { id: rowId }, data: { transactionId, sentAt: new Date() } })
    await logAudit({
      action: AuditAction.ADMIN_SEND_GRANT,
      actorId: input.adminId,
      actorEmail: input.adminEmail,
      targetType: "ThemeProject",
      targetId: project.id,
      metadata: { phase: input.phase, grantHashid: hashid, amountCents, transactionId },
    })
    return { amountCents, transactionId, alreadySent: false }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await prisma.hcbGrantTopUp.update({ where: { id: rowId }, data: { error: message } }).catch(() => undefined)
    throw err
  }
}
