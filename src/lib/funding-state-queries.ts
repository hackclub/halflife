import "server-only"
import { recordIdsFromSyncEvents } from "@/lib/airtable/sync"
import { readUnifiedSubmitted } from "@/lib/airtable/ysws"
import { HcbGrantCardStatus, Phase, PhaseStatus } from "@/lib/enums"
import { type FundingState, fundingState } from "@/lib/funding-state"
import db from "@/lib/prisma8"

interface DesignMoney {
	designStatus: PhaseStatus
	grantUsd: number | null
	id: string
}

/**
 * The funding stage of each project whose design is approved with a grant to wait on. A project with none is left out of the map, so the caller shows nothing for it rather than a stage it never reaches.
 *
 * Two reads back it: the design's grant cards, where an issued or returned card means funded, and the design's Airtable row, checked against the unified database the way the grant preview checks it. One batch each, however many projects are asked about, and an unreadable Airtable leaves the unfunded projects unlabelled rather than queued.
 */
export async function designFundingStates(projects: readonly DesignMoney[]): Promise<Map<string, FundingState>> {
	const states = new Map<string, FundingState>()
	const candidates = projects.filter(p => p.designStatus === PhaseStatus.approved && (p.grantUsd ?? 0) > 0)
	if (candidates.length === 0) return states
	const ids = candidates.map(p => p.id)

	const cards = await db.orm.public.HcbGrantCard.where({ phase: Phase.DESIGN })
		.where(card => card.status.in([HcbGrantCardStatus.ISSUED, HcbGrantCardStatus.RETURNED]))
		.where(card => card.themeProjectId.in([...ids]))
		.select("themeProjectId")
		.all()
	const issued = new Set(cards.map(card => card.themeProjectId))

	const events = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in([...ids]))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const recordIds = recordIdsFromSyncEvents(events)
	const recordIdOf = (id: string) => recordIds.get(`${id}:${Phase.DESIGN}`)
	const unified = await readUnifiedSubmitted(ids.map(recordIdOf).filter((id): id is string => Boolean(id)))

	for (const id of ids) {
		const recordId = recordIdOf(id)
		// A design that never reached Airtable is not in the unified database, so it is queued rather than unknown.
		const inUnified = unified === null ? null : recordId ? unified.has(recordId) : false
		const state = fundingState({ cardIssued: issued.has(id), inUnified })
		if (state) states.set(id, state)
	}
	return states
}
