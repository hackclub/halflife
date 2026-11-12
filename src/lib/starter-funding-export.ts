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
import { decryptUserPII } from "@/lib/pii"
import db from "@/lib/prisma8"
import { getProgramSettings } from "@/lib/program"
import { type StarterFulfilment, starterFundingFor } from "@/lib/starter-funding"
import { countriesAgree, type KitShipRow } from "@/lib/starter-funding-csv"

/**
 * The starter export's reads: which Week 1 starters are approved, what the operator has recorded for each in Airtable, and what each is owed.
 *
 * Read-only. The CLI in `scripts/starter-funding-export.ts` writes the files; this decides what goes in them.
 */

/** The offer deadline for every waiting maker: the kit offers went out on 10 November, and 13 November is the last day. Past it, a no-response maker is flagged for the operator to expire. */
export const KIT_OFFER_DEADLINE = new Date("2026-11-14T00:00:00Z")

export interface StarterFundingDecision {
	address: KitShipRow | null
	airtableRecordId: string | null
	/** The card still to send, in USD. Zero when none is owed. */
	cardUsd: number
	email: string
	fulfilment: StarterFulfilment
	name: string
	owedUsd: number
	projectId: string
	reason: string
	title: string
}

interface SheetRow {
	country: string | null
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
	const { country, firstSubmittedAt, fundingGiven, kitStatus } = YSWS_SUBMISSION.fields
	const wanted = [kitStatus, fundingGiven, country, firstSubmittedAt]
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
				country: text(record.fields[country.name]),
				fundingGivenUsd: money(record.fields[fundingGiven.name]),
				kitStatus: text(record.fields[kitStatus.name]),
				submitted: text(record.fields[firstSubmittedAt.name]) !== null,
			})
	}
	return sheet
}

/**
 * Every approved Week 1 starter, with what it is owed. Refuses to answer when the payout source is not HCB, or when Airtable's country and the verified address disagree on a row that is in the unified database, since either one could be the wrong address.
 */
export async function starterFundingDecisions(now: Date): Promise<StarterFundingDecision[]> {
	const settings = await getProgramSettings()
	if (settings.payoutSource !== PayoutSource.HCB)
		throw new Error("The payout source is not HCB. Starter cards are only exported under HCB card grants.")
	const config = getAirtableConfig()
	if (!config) throw new Error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID first")

	const starterIds = starterProjectsFor(Theme.PCB).map(starter => starter.id)
	const projects = await db.orm.public.ThemeProject.where({ deletedAt: null, designStatus: PhaseStatus.approved })
		.where(project => project.starterProjectId.in(starterIds))
		.select("bomTaxShippingUsd", "id", "tier", "title")
		.include("user", user =>
			user.select(
				"displayName",
				"email",
				"encryptedAddressCity",
				"encryptedAddressCountry",
				"encryptedAddressLine2",
				"encryptedAddressState",
				"encryptedAddressStreet",
				"encryptedAddressZip",
				"name",
			),
		)
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

	const decisions: StarterFundingDecision[] = []
	const mismatches: string[] = []
	for (const project of projects) {
		const { user } = project
		const recordId = recordIdOf(project.id)
		const row = recordId ? (sheet.get(recordId) ?? null) : null
		const address = user ? decryptUserPII(user) : null

		if (row?.submitted && !countriesAgree(row.country, address?.country ?? null))
			mismatches.push(`${project.id} (Airtable ${row.country ?? "blank"}, address ${address?.country ?? "blank"})`)

		const items = await listBom(project.id)
		const bom = bomTotalUsd(items, project.bomTaxShippingUsd)
		const verdict = starterFundingFor({
			approved: true,
			bomTotalUsd: bom,
			country: address?.country ?? null,
			fundingGivenUsd: row?.fundingGivenUsd ?? 0,
			kitOfferDeadline: KIT_OFFER_DEADLINE,
			kitStatus: row?.kitStatus ?? null,
			now,
			submitted: row?.submitted ?? false,
			tier: project.tier,
		})

		decisions.push({
			address:
				user && address
					? {
							city: address.city ?? "",
							country: address.country ?? "",
							email: user.email,
							line1: address.line1 ?? "",
							line2: address.line2 ?? "",
							name: displayName(user, "(no name)"),
							state: address.state ?? "",
							zip: address.zip ?? "",
						}
					: null,
			airtableRecordId: recordId,
			cardUsd: verdict.cardUsd,
			email: user?.email ?? "",
			fulfilment: verdict.fulfilment,
			name: user ? displayName(user, "(no name)") : "(no owner)",
			owedUsd: verdict.owedUsd,
			projectId: project.id,
			reason: user ? verdict.reason : "project has no owner",
			title: project.title,
		})
	}

	if (mismatches.length > 0)
		throw new Error(
			`Airtable's country and the verified address disagree for ${mismatches.length} row(s): ${mismatches.join("; ")}`,
		)
	return decisions
}
