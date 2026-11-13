import "server-only"
import {
	type AirtableConfig,
	AirtableListSchema,
	airtableFetch,
	chunk,
	escapeAirtableValue,
	getAirtableConfig,
	withRateLimitRetry,
} from "@/lib/airtable/client"
import { fieldKey, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "@/lib/airtable/sync"
import { listBom } from "@/lib/bom"
import { bomTotalUsd } from "@/lib/bom-policy"
import { starterProjectsFor } from "@/lib/config/onboarding"
import { displayName } from "@/lib/display-name"
import { PayoutSource, Phase, PhaseStatus, Theme } from "@/lib/enums"
import { payoutBlockReason } from "@/lib/moderation"
import db from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { liveRecordedCents, liveWaveCardCents } from "@/lib/starter-card-records"
import { paidSoFarUsd, type StarterFulfilment, starterAction, starterFundingFor } from "@/lib/starter-funding"

/**
 * The starter export's reads: which Week 1 starters are approved, what the operator has recorded for each in Airtable, the site's BOM, and what each is owed.
 *
 * Read-only. The CLI in `scripts/starter-funding-export.ts` writes the files; this decides what goes in them.
 */

export interface StarterFundingDecision {
	/** `NEW_CARD`: no live card is recorded, so the card goes in the import file. `TOP_UP`: a live card exists, so it is topped up by hand in HCB. Null when nothing is owed. */
	action: "NEW_CARD" | "TOP_UP" | null
	airtableRecordId: string | null
	bomTotalUsd: number
	/** The card amount the maker is entitled to in total, in USD. */
	cardUsd: number
	email: string
	fulfilment: StarterFulfilment
	/** What the operator has recorded as sent, in USD. */
	fundingGivenUsd: number
	name: string
	owedUsd: number
	projectId: string
	reason: string
	/** The live card recorded for this project, in USD. Null when none is recorded. */
	recordedCardUsd: number | null
	title: string
}

interface SheetRow {
	fundingGivenUsd: number
	kitStatus: string | null
	submitted: boolean
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function money(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0
}

/** The Airtable record for each listed design, keyed by record ID. A missing record is left out, so the caller treats it as not submitted. */
async function readSheet(config: AirtableConfig, recordIds: readonly string[]): Promise<Map<string, SheetRow>> {
	const sheet = new Map<string, SheetRow>()
	if (recordIds.length === 0) return sheet
	const { firstSubmittedAt, fundingGiven, kitStatus } = YSWS_SUBMISSION.fields
	const wanted = [kitStatus, fundingGiven, firstSubmittedAt]
		.map(field => `fields[]=${encodeURIComponent(fieldKey(field))}`)
		.join("&")
	for (const part of chunk([...recordIds], 50)) {
		const formula = `OR(${part.map(id => `RECORD_ID()='${escapeAirtableValue(id)}'`).join(",")})`
		const result = await withRateLimitRetry("readStarterFundingSheet", () =>
			airtableFetch(
				AirtableListSchema,
				config,
				`${YSWS_SUBMISSION.tableId}?maxRecords=${part.length}&${wanted}&filterByFormula=${encodeURIComponent(formula)}`,
			),
		)
		for (const record of result.records ?? [])
			sheet.set(record.id, {
				fundingGivenUsd: money(record.fields[fundingGiven.name]),
				kitStatus: text(record.fields[kitStatus.name]),
				submitted: text(record.fields[firstSubmittedAt.name]) !== null,
			})
	}
	return sheet
}

/** Every approved Week 1 starter, with what it is owed. Refuses to answer when the payout source is not HCB. */
export async function starterFundingDecisions(): Promise<StarterFundingDecision[]> {
	const settings = await getProgramSettings()
	if (settings.payoutSource !== PayoutSource.HCB)
		throw new Error("The payout source is not HCB. Starter cards are only issued under HCB card grants.")
	const config = getAirtableConfig()
	if (!config) throw new Error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")

	const starterIds = starterProjectsFor(Theme.PCB).map(starter => starter.id)
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null, designStatus: PhaseStatus.approved })
		.where(project => project.starterProjectId.in(starterIds))
		.select("bomTaxShippingUsd", "id", "tier", "title")
		.include("user", user => user.select("bannedAt", "displayName", "email", "fraudFlagged", "name", "suspendedUntil"))
		.all()

	const events = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in(projects.map(project => project.id)))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const recordIds = recordIdsFromSyncEvents(events)
	const recordIdOf = (projectId: string): string | null => recordIds.get(`${projectId}:${Phase.DESIGN}`) ?? null
	const sheet = await readSheet(
		config,
		projects.map(project => recordIdOf(project.id)).filter((id): id is string => id !== null),
	)

	const recorded = await liveRecordedCents(projects.map(project => project.id))
	const waveCards = await liveWaveCardCents(projects.map(project => project.id))
	const decisions: StarterFundingDecision[] = []
	for (const project of projects) {
		const { user } = project
		const recordId = recordIdOf(project.id)
		const row = recordId ? (sheet.get(recordId) ?? null) : null
		const items = await listBom(project.id)
		const bom = bomTotalUsd(items, project.bomTaxShippingUsd)
		// The largest live card for the project, from the CSV records or the grant wave. Never added together: the same card can appear in both.
		const recordedCents = Math.max(recorded.get(project.id) ?? 0, waveCards.get(project.id) ?? 0)
		const recordedCardUsd = recordedCents > 0 ? recordedCents / 100 : null
		const fundingGivenUsd = row?.fundingGivenUsd ?? 0
		const verdict = starterFundingFor({
			approved: true,
			bomTotalUsd: bom,
			fundingGivenUsd: paidSoFarUsd(fundingGivenUsd, recordedCardUsd),
			kitStatus: row?.kitStatus ?? null,
			submitted: row?.submitted ?? false,
			tier: project.tier,
		})
		// The same gate the decision and card paths use: a banned, suspended or flagged account is owed nothing while it stands, so a batch built here cannot pay it. Only a row that would otherwise send a card is flagged – "nothing more is owed" stays what it is.
		const payoutBlock = user ? payoutBlockReason(user) : null
		const decision =
			payoutBlock && verdict.owedUsd > 0
				? { ...verdict, fulfilment: "FLAG" as const, owedUsd: 0, reason: payoutBlock }
				: verdict

		decisions.push({
			action: starterAction(decision.owedUsd, recordedCardUsd),
			airtableRecordId: recordId,
			bomTotalUsd: bom,
			cardUsd: decision.cardUsd,
			email: user?.email ?? "",
			fulfilment: decision.fulfilment,
			fundingGivenUsd,
			name: user ? displayName(user, "(no name)") : "(no owner)",
			owedUsd: decision.owedUsd,
			projectId: project.id,
			reason: user ? decision.reason : "project has no owner",
			recordedCardUsd,
			title: project.title,
		})
	}
	return decisions
}
