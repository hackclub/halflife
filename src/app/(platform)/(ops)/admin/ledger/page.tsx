import type { Metadata } from "next"
import { LedgerList } from "@/app/components/admin/LedgerList"
import { Field, FilterBar, PageHeader, Panel, Select, Stat, TextInput } from "@/app/components/ui"
import { LedgerKind } from "@/lib/enums"
import { ledgerKindFrom, ledgerKindLabel, utcDay } from "@/lib/ledger-filters"
import { fmtInt } from "@/lib/numbers"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listLedgerEntries } from "@/lib/queries/admin-ledger"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { DAY_MS } from "@/lib/time"

export const metadata: Metadata = {
	title: "Ledger",
}

export const dynamic = "force-dynamic"

interface Search {
	cursor?: SearchParamValue
	from?: SearchParamValue
	kind?: SearchParamValue
	q?: SearchParamValue
	to?: SearchParamValue
}
interface Props {
	searchParams: Promise<Search>
}

export default async function AdminLedgerPage({ searchParams }: Props) {
	// Every account's bits in one place, so it is guarded by the permission that moves them, not the one that reads a single profile.
	const { roles } = await requirePermissionPage(Permission.MANAGE_CREDIT)
	// Each filter is taken as the single value the URL named: a repeated parameter arrives as an array, and an array is not a value this page can read.
	const { cursor, from, kind: kindParam, q, to } = firstValues(await searchParams)
	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const kind = ledgerKindFrom(kindParam)
	const fromDay = utcDay(from)
	const toDay = utcDay(to)

	const { items, nextCursor, count, total } = await listLedgerEntries(
		{
			from: fromDay,
			kind,
			q,
			// The "to" day is inclusive, so the bound is the midnight after it.
			to: toDay ? new Date(toDay.getTime() + DAY_MS) : undefined,
		},
		{ cursor, limit: 50 },
		{ includePii },
	)

	// The rows below load more as they are scrolled to, through the same filters, so the list's address carries them all. A row's kind badge links back to the page with that kind added to the same filters.
	const filterParams = new URLSearchParams(
		Object.entries({ from, kind: kindParam, q, to }).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
		),
	)
	const baseUrl = `/api/admin/ledger?${filterParams.toString()}`
	const pageParams = new URLSearchParams(
		Object.entries({ from, q, to }).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
		),
	)
	const rows = items.map(entry => ({ ...entry, createdAt: entry.createdAt.toISOString() }))

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader compact subtitle="Every credit movement, newest first." title="Ledger" />

			<div className="hl-row">
				<Stat label="Entries matched" value={fmtInt(count)} />
				<Stat label="Net credit over the filters" value={total > 0 ? `+${fmtInt(total)}` : fmtInt(total)} />
			</div>

			<Panel>
				<FilterBar footer={<span className="hl-hint">Dates and times are UTC.</span>} resetHref="/admin/ledger">
					<Field label="Participant">
						<TextInput
							defaultValue={q ?? ""}
							name="q"
							placeholder={includePii ? "Search by name or email" : "Search by name"}
							style={{ maxWidth: "20rem" }}
						/>
					</Field>
					<Field label="Kind">
						<Select defaultValue={kind ?? ""} name="kind">
							<option value="">Any kind</option>
							{Object.values(LedgerKind).map(value => (
								<option key={value} value={value}>
									{ledgerKindLabel(value)}
								</option>
							))}
						</Select>
					</Field>
					<Field label="From">
						<TextInput defaultValue={from ?? ""} name="from" type="date" />
					</Field>
					<Field label="To">
						<TextInput defaultValue={to ?? ""} name="to" type="date" />
					</Field>
				</FilterBar>
			</Panel>

			<Panel>
				{/* Keyed on the filters, so a new search starts a new list rather than appending to the old one. */}
				<LedgerList
					baseUrl={baseUrl}
					filters={pageParams.toString()}
					initialCursor={nextCursor}
					initialRows={rows}
					key={filterParams.toString()}
				/>
			</Panel>
		</div>
	)
}
