import { STARTER_PROJECTS } from "@/lib/config/onboarding"
import { isTierId } from "@/lib/config/tiers"

/** The queue's narrowing filters, each null or "" for everything. */
export interface QueueFacets {
	/** "any" for every starter, "none" for the maker's own idea, or one starter's id. */
	starter: string
	/** The tier the row's badge shows: the approved tier once there is one, the requested tier before. */
	tier: number | null
	/** The program week the submission is scheduled for – its theme's week, not the week it was handed in. */
	week: number | null
}

/** The filters that pick which ships a reviewer works through: the queue's, and the review screen's "next ship", which follows them. */
export interface QueueFilters extends QueueFacets {
	kind: "" | "design" | "build"
}

export const isStarterFilter = (value: string | undefined): value is string =>
	value === "any" || value === "none" || STARTER_PROJECTS.some(starter => starter.id === value)

export function queueFiltersFrom(params: {
	kind?: string
	starter?: string
	tier?: string
	week?: string
}): QueueFilters {
	const tier = Number(params.tier)
	return {
		kind: params.kind === "design" || params.kind === "build" ? params.kind : "",
		starter: isStarterFilter(params.starter) ? params.starter : "",
		tier: isTierId(tier) ? tier : null,
		week: /^\d{1,2}$/.test(params.week ?? "") ? Number(params.week) : null,
	}
}

/** The filters as query parameters, so the queue's links carry them onto the review screen and back. */
export function queueFilterParams(filters: QueueFilters): URLSearchParams {
	const params = new URLSearchParams()
	if (filters.kind) params.set("kind", filters.kind)
	if (filters.week !== null) params.set("week", String(filters.week))
	if (filters.tier !== null) params.set("tier", String(filters.tier))
	if (filters.starter) params.set("starter", filters.starter)
	return params
}
