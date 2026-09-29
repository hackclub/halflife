import "server-only"
import { Phase, PhaseStatus } from "@/app/generated/prisma/enums"
import { formatProgramDate, getProgramSettings, weekOpensAt } from "@/lib/program"

/**
 * The warm-up: projects made before week 1 opens, on any hardware idea rather
 * than a theme. Each one is a single submission — a design asking for parts
 * funding, or a finished build — and its journal closes the moment week 1
 * opens (week 0's close in lib/program is week 1's open). Anything unfinished
 * can still be handed in after that; it just takes no new entries.
 */

/**
 * The one phase a warm-up is handed in as.
 *
 * Made on the platform, that is the choice recorded at creation. Imported from
 * Airtable there is no choice on the row, so it is whichever phase the import
 * put in review — the build if that one has left draft, the design otherwise.
 */
export function warmupPhaseOf(project: { warmupPhase: Phase | null; buildStatus: PhaseStatus }): Phase {
  if (project.warmupPhase) return project.warmupPhase
  return project.buildStatus !== PhaseStatus.draft ? Phase.BUILD : Phase.DESIGN
}

/** Whether a warm-up project can still be started, and when that stops. */
export async function warmupCreationWindow(): Promise<{ open: boolean; closesAt: Date; closesOn: string }> {
  const settings = await getProgramSettings()
  const closesAt = weekOpensAt(settings, 1)
  return {
    open: new Date() < closesAt,
    closesAt,
    closesOn: formatProgramDate(closesAt, settings.programTimezone),
  }
}
