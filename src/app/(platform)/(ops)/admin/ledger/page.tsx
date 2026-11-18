import Link from "next/link"
import {
	Badge,
	Button,
	EmptyState,
	Field,
	PageHeader,
	Panel,
	Select,
	Stat,
	Table,
	TextInput,
} from "@/app/components/ui"
import { IconFilter } from "@/app/components/ui/icons"
import { formatUtcDateTime } from "@/lib/deadline"
import { LedgerKind } from "@/lib/enums"
import { ledgerKindFrom, ledgerKindLabel, utcDay } from "@/lib/ledger-filters"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listLedgerEntries } from "@/lib/queries/admin-ledger"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { DAY_MS } from "@/lib/time"

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

/** Figures that line up when read down the column. A block so it also right-aligns the heading above them. */
const NUMERIC = { display: "block", fontVariantNumeric: "tabular-nums", textAlign: "right" } as const

export default async function AdminLedgerPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
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

	// The next page keeps every filter; only the cursor moves.
	const nextParams = new URLSearchParams(
		Object.entries({ cursor: nextCursor ?? undefined, from, kind: kindParam, q, to }).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
		),
	)

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader compact subtitle="Every credit movement, newest first." title="Ledger" />

			<div className="hl-row">
				<Stat label="Entries matched" value={count} />
				<Stat label="Net credit over the filters" value={total > 0 ? `+${total}` : total} />
			</div>

			<Panel>
				<form className="hl-row" method="get" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
					<TextInput
						defaultValue={q ?? ""}
						name="q"
						placeholder={includePii ? "Search by name or email" : "Search by name"}
						style={{ maxWidth: "20rem" }}
					/>
					<Select defaultValue={kind ?? ""} name="kind" style={{ maxWidth: "14rem" }}>
						<option value="">Any kind</option>
						{Object.values(LedgerKind).map(value => (
							<option key={value} value={value}>
								{ledgerKindLabel(value)}
							</option>
						))}
					</Select>
					<Field label="From">
						<TextInput defaultValue={from ?? ""} name="from" type="date" />
					</Field>
					<Field label="To">
						<TextInput defaultValue={to ?? ""} name="to" type="date" />
					</Field>
					<Button type="submit">
						<IconFilter /> Filter
					</Button>
					<Link className="hl-hint" href="/admin/ledger">
						Reset
					</Link>
				</form>
				<span className="hl-hint">Dates and times are UTC.</span>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>No ledger entries match.</EmptyState>
				) : (
					<Table
						head={[
							"When",
							"Participant",
							"Kind",
							"Note",
							<span key="amount" style={NUMERIC}>
								Amount
							</span>,
						]}
					>
						{items.map(entry => (
							<tr key={entry.id}>
								<td className="hl-mono">{formatUtcDateTime(entry.createdAt)}</td>
								<td>
									<Link href={`/admin/users/${entry.user.id}`}>{entry.user.name ?? "-"}</Link>
								</td>
								<td>
									<Badge tone={entry.amount > 0 ? "success" : entry.amount < 0 ? "danger" : "muted"}>
										{ledgerKindLabel(entry.kind)}
									</Badge>
								</td>
								<td>{entry.note ?? <span className="hl-hint">-</span>}</td>
								<td className="hl-mono" style={NUMERIC}>
									{entry.amount > 0 ? `+${entry.amount}` : entry.amount}
								</td>
							</tr>
						))}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link href={`/admin/ledger?${nextParams.toString()}`}>Next page</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
