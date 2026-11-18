import { GRANT_CARD_PURPOSE } from "@/lib/grant-card-policy"
import type { HcbCardGrantSummary } from "@/lib/hcb"

/**
 * Matches the live CSV export rows against the card grants HCB actually holds.
 *
 * A row is recorded as paid as soon as its CSV is generated, but HCB only creates the cards when someone uploads the file. So a row can be live for a grant that was never made, and it then blocks its project from ever being paid. This decides, row by row, whether HCB confirms the payment, whether no grant can be it, or whether the evidence is too thin to say.
 *
 * Pure, so the rules can be tested without HCB or the database. It fails closed: a row is only `missing` when no grant at all could have paid it, and anything that could be read two ways is `ambiguous` and left alone.
 */

export interface ExportRowForReconcile {
	amountCents: number
	email: string
	id: string
}

export interface ExportRowVerdict {
	kind: "landed" | "missing" | "ambiguous"
	reason: string
	rowId: string
}

export interface ExportReconciliation {
	/** Grants that match a maker and amount with more rows than there are grants: they may be payments the site does not know about. */
	surplus: HcbCardGrantSummary[]
	verdicts: ExportRowVerdict[]
}

/** Whether a grant's purpose is the one every Half Life card carries, with or without the project name after it. */
export function isHalfLifePurpose(purpose: string): boolean {
	return purpose === GRANT_CARD_PURPOSE || purpose.startsWith(`${GRANT_CARD_PURPOSE} – `)
}

const normalEmail = (email: string | null): string | null => email?.trim().toLowerCase() ?? null

/** HCB lists card grants as `cdg_…`, while the site stores the bare hashid. Compare on the bare one. */
const bareId = (id: string): string => id.replace(/^cdg_/, "")

/**
 * `rows` are the live export rows; `grants` are every card grant the organisation holds, as HCB lists them; `claimed` are the bare HCB ids Half Life already tracks through its own API cards, which a CSV row cannot be. A grant's amount here is its original amount, so the caller takes buffer top-ups off first.
 *
 * A canceled grant pays nothing, so it is not evidence. Only a grant with a Half Life purpose and the row's maker and amount counts, and a grant HCB will not show the owner or purpose of blocks a verdict of `missing` for its amount.
 */
export function reconcileExportRows(
	rows: readonly ExportRowForReconcile[],
	grants: readonly HcbCardGrantSummary[],
	claimed: ReadonlySet<string>,
): ExportReconciliation {
	const live = grants.filter(grant => grant.status?.toLowerCase() !== "canceled" && !claimed.has(bareId(grant.id)))
	const groups = new Map<string, { amountCents: number; email: string; rows: ExportRowForReconcile[] }>()
	for (const row of rows) {
		const email = normalEmail(row.email) ?? ""
		const key = `${email}|${row.amountCents}`
		const group = groups.get(key) ?? { amountCents: row.amountCents, email, rows: [] }
		group.rows.push(row)
		groups.set(key, group)
	}

	const verdicts: ExportRowVerdict[] = []
	const surplus: HcbCardGrantSummary[] = []
	// A grant can be evidence for one row only. The caller offers a buffered grant twice (at its full and its net
	// amount), so without this the same grant could confirm two rows with the same maker and different amounts.
	const used = new Set<string>()
	const available = (grant: HcbCardGrantSummary): boolean =>
		grant.status?.toLowerCase() !== "canceled" && !claimed.has(bareId(grant.id)) && !used.has(bareId(grant.id))
	for (const group of groups.values()) {
		const sameAmount = live.filter(grant => available(grant) && grant.amountCents === group.amountCents)
		const hidden = sameAmount.some(grant => grant.email === null || grant.purpose === null)
		const mine = sameAmount.filter(
			grant => normalEmail(grant.email) === group.email && isHalfLifePurpose(grant.purpose ?? ""),
		)
		// Every grant not canceled for this maker and amount, including ones the site already tracks, whatever their purpose. A canceled grant is left out: admins cancel and reissue cards, so the reissue is the payment, and a canceled card alone proves nothing. A row is only missing when no live grant of this maker and amount exists.
		const sameMaker = grants.filter(
			grant =>
				grant.amountCents === group.amountCents
				&& normalEmail(grant.email) === group.email
				&& grant.status?.toLowerCase() !== "canceled",
		)
		const judge = (kind: ExportRowVerdict["kind"], reason: string): void => {
			for (const row of group.rows) verdicts.push({ kind, reason, rowId: row.id })
		}

		if (hidden) {
			judge("ambiguous", "HCB hides the owner or purpose of a grant for this amount, so it cannot be ruled out")
			continue
		}
		if (mine.length === 0 && sameMaker.length === 0) {
			judge("missing", "HCB holds no card grant at all for this maker and amount")
			continue
		}
		if (mine.length === 0) {
			const described = sameMaker.map(grant => `${grant.status ?? "no status"} / ${grant.purpose ?? "no purpose"}`)
			judge(
				"ambiguous",
				`HCB holds ${sameMaker.length} grant(s) for this maker and amount, none a live Half Life grant (${described.join("; ")})`,
			)
			continue
		}
		if (mine.length < group.rows.length) {
			judge(
				"ambiguous",
				`HCB holds ${mine.length} grant(s) for ${group.rows.length} row(s) with this maker and amount, so it cannot tell which project each paid`,
			)
			continue
		}
		judge("landed", "HCB holds a card grant for this maker and amount")
		for (const grant of mine.slice(0, group.rows.length)) used.add(bareId(grant.id))
		surplus.push(...mine.slice(group.rows.length))
	}
	return { surplus, verdicts }
}

/**
 * Apply human decisions on top of the matcher. The matcher cannot tell who cancelled a grant, so a person checks each HCB grant and passes the verdicts through here.
 *
 * `confirmedPaid` rows become `landed`, whatever the matcher said, because the maker returned or converted the grant. `supersede` only lets a `missing` row through to be superseded, so a row that is missing but not on the list is left live and reported.
 */
export function applyReviewedDecisions(
	verdicts: readonly ExportRowVerdict[],
	decisions: { confirmedPaid: ReadonlySet<string>; supersede: ReadonlySet<string> },
): ExportRowVerdict[] {
	return verdicts.map(verdict => {
		if (decisions.confirmedPaid.has(verdict.rowId))
			return {
				kind: "landed",
				reason: "Confirmed paid: the maker returned or converted the grant on HCB",
				rowId: verdict.rowId,
			}
		if (verdict.kind === "missing" && !decisions.supersede.has(verdict.rowId))
			return { ...verdict, reason: `${verdict.reason}. Not on the reviewed supersede list, so left live` }
		return verdict
	})
}
