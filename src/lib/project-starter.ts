import { starterProjectsFor } from "@/lib/config/onboarding"
import { type PhaseStatus, PhaseStatus as Status, type Theme } from "@/lib/enums"

/**
 * Whether an admin may set a project's starter project, as the maker's own route would allow it.
 *
 * A starter has to be one the project's week offers, and the project has to be on Tier 1, since a starter is always a Tier 1 build. The tier that counts is the one the project is funded at: the approved tier once the design is approved, and the requested tier before that. Clearing a starter is always allowed.
 */

const STARTER_TIER = 1

export interface StarterTarget {
	designStatus: PhaseStatus
	requestedTier: number | null
	theme: Theme
	tier: number | null
}

/** The reason a starter cannot be set on this project, or null when it can. */
export function starterProblem(target: StarterTarget, starterProjectId: string | null): string | null {
	if (starterProjectId === null) return null
	if (!starterProjectsFor(target.theme).some(starter => starter.id === starterProjectId))
		return "That starter is not offered on this project's week"
	const funded =
		target.designStatus === Status.approved
			? (target.tier ?? target.requestedTier)
			: (target.requestedTier ?? target.tier)
	if (funded !== STARTER_TIER) return "A starter project has to be Tier 1"
	return null
}
