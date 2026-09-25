import "server-only"
import prisma from "@/lib/prisma"
import { HoursSource, Phase } from "@/app/generated/prisma/enums"
import { getHoursBreakdown } from "@/lib/hours"
import { getThemeDef } from "@/lib/config/program"

/**
 * The text that lands in `Optional - Override Hours Spent Justification` on the
 * grant row. A human on the payout team reads this, so it has to stand alone.
 */
export async function buildHoursJustification(input: {
  themeProjectId: string
  phase: Phase
  reviewerName?: string | null
  reviewerNote?: string | null
}): Promise<string> {
  const project = await prisma.themeProject.findUnique({
    where: { id: input.themeProjectId },
    select: { theme: true, title: true, tier: true },
  })
  if (!project) return ""

  const breakdown = await getHoursBreakdown(input.themeProjectId, input.phase)
  const sessions = await prisma.workSession.findMany({
    where: { themeProjectId: input.themeProjectId, phase: input.phase, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      hoursClaimed: true,
      hoursApproved: true,
      hoursSource: true,
      effectiveDate: true,
    },
  })

  const lines: string[] = []
  lines.push(
    `Half-Life — ${getThemeDef(project.theme).label}, ${input.phase === Phase.DESIGN ? "design" : "build"} phase.`,
  )
  if (project.tier) lines.push(`Reviewed at Tier ${project.tier}.`)
  lines.push("")
  lines.push(`Journal: ${breakdown.journalHours}h across ${breakdown.journalEntryCount} entries.`)
  if (breakdown.hackatimeHours > 0) {
    lines.push(`Hackatime (firmware/code): ${breakdown.hackatimeHours}h.`)
  }
  if (breakdown.timelapseSeconds > 0) {
    // Coverage, not "hours of lapse". A 30x timelapse of eight hours has a
    // four-minute runtime; reporting that as hours makes it look like the
    // participant did almost nothing.
    lines.push(`Timelapse evidence covers ${Math.round(breakdown.timelapseCoverage * 100)}% of claimed time.`)
  }
  lines.push(`Total approved: ${breakdown.effectiveHours}h.`)
  lines.push("")
  lines.push("Entries:")
  for (const s of sessions) {
    const hours = s.hoursApproved ?? s.hoursClaimed
    const tracked = s.hoursSource === HoursSource.HACKATIME_TRACKED ? " (counted via Hackatime)" : ""
    const adjusted =
      s.hoursApproved !== null && s.hoursApproved !== s.hoursClaimed ? ` [claimed ${s.hoursClaimed}h]` : ""
    lines.push(`- ${s.effectiveDate ?? "undated"}: ${s.title} — ${hours}h${adjusted}${tracked}`)
  }

  if (input.reviewerNote) {
    lines.push("")
    lines.push(`Reviewer note: ${input.reviewerNote}`)
  }
  if (input.reviewerName) {
    lines.push("")
    lines.push(`Reviewed by ${input.reviewerName}.`)
  }
  return lines.join("\n")
}
