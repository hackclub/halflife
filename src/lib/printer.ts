import "server-only"
import prisma from "@/lib/prisma"
import { PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import type { PrinterAward, Prisma } from "@/app/generated/prisma/client"
import { THEMES, THEMES_REQUIRED_FOR_PRINTER } from "@/lib/config/program"

export interface ThemeProgress {
  theme: Theme
  design: boolean
  build: boolean
  shipped: boolean
}

export interface PrinterQualification {
  qualified: boolean
  shippedCount: number
  required: number
  progress: ThemeProgress[]
}

/**
 * Always derived from ThemeProject state, never read from PrinterAward.
 *
 * Keeping eligibility and fulfilment separate means an un-approval after the
 * award surfaces as a mismatch an admin resolves, rather than silently
 * revoking a printer that is already in a box.
 */
export async function getPrinterQualification(userId: string): Promise<PrinterQualification> {
  const projects = await prisma.themeProject.findMany({
    where: { userId, deletedAt: null },
    select: { theme: true, designStatus: true, buildStatus: true, buildReviewedAt: true },
  })
  const byTheme = new Map(projects.map((p) => [p.theme, p]))

  const progress: ThemeProgress[] = THEMES.map((def) => {
    const p = byTheme.get(def.id)
    const design = p?.designStatus === PhaseStatus.approved
    const build = p?.buildStatus === PhaseStatus.approved
    return { theme: def.id, design, build, shipped: design && build }
  })

  const shippedCount = progress.filter((p) => p.shipped).length
  return {
    qualified: shippedCount >= THEMES_REQUIRED_FOR_PRINTER,
    shippedCount,
    required: THEMES_REQUIRED_FOR_PRINTER,
    progress,
  }
}

/**
 * Create the award row the first time someone qualifies. Idempotent, and safe
 * to call inside the review transaction.
 */
export async function ensurePrinterAward(tx: Prisma.TransactionClient, userId: string): Promise<PrinterAward | null> {
  const projects = await tx.themeProject.findMany({
    where: {
      userId,
      deletedAt: null,
      designStatus: PhaseStatus.approved,
      buildStatus: PhaseStatus.approved,
    },
    select: { theme: true, buildReviewedAt: true },
  })
  if (projects.length < THEMES_REQUIRED_FOR_PRINTER) return null

  const existing = await tx.printerAward.findUnique({ where: { userId } })
  if (existing) return existing

  return tx.printerAward.create({
    data: {
      userId,
      qualifiedAt: new Date(),
      // Snapshot the evidence so a later un-approval doesn't erase why this
      // award exists.
      qualifyingSnapshot: projects.map((p) => ({
        theme: p.theme,
        buildReviewedAt: p.buildReviewedAt?.toISOString() ?? null,
      })),
    },
  })
}

/**
 * Awards whose holder no longer qualifies. Reports only — never auto-revokes,
 * because the printer may already have shipped.
 */
export async function findPrinterAwardMismatches(): Promise<{ userId: string; email: string; shippedCount: number }[]> {
  const awards = await prisma.printerAward.findMany({
    where: { revokedAt: null },
    select: { userId: true, user: { select: { email: true } } },
  })
  const mismatches: { userId: string; email: string; shippedCount: number }[] = []
  for (const award of awards) {
    const q = await getPrinterQualification(award.userId)
    if (!q.qualified) {
      mismatches.push({
        userId: award.userId,
        email: award.user.email,
        shippedCount: q.shippedCount,
      })
    }
  }
  return mismatches
}
