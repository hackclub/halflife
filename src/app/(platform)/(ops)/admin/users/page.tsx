import Link from "next/link"
import { ClipboardSearchButton } from "@/app/components/admin/ClipboardSearchButton"
import { UserDirectory } from "@/app/components/admin/UserDirectory"
import { Button, PageHeader, Panel, TextInput } from "@/app/components/ui"
import { IconSearch } from "@/app/components/ui/icons"
import { toDirectoryRow } from "@/lib/directory-rows"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listUsers, USER_STATES, type UserState } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const dynamic = "force-dynamic"

interface Props {
	searchParams: Promise<{ q?: SearchParamValue; state?: SearchParamValue }>
}

/** The filter chips' labels, in the order an admin is most likely to want them. */
const STATE_LABELS: { [_ in UserState]: string } = {
	all: "Everyone",
	banned: "Banned",
	flagged: "Fraud flagged",
	suspended: "Suspended",
	unverified: "Not verified",
}

/** The directory URL for one filter, keeping the search. An empty search and the "Everyone" chip both leave their parameter off. */
const directoryHref = (state: UserState, q: string | undefined): string => {
	const params = new URLSearchParams()
	if (q) params.set("q", q)
	if (state !== "all") params.set("state", state)
	const query = params.toString()
	return query ? `/admin/users?${query}` : "/admin/users"
}

export default async function AdminUsersPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	// Each filter is taken as the single value the URL named: a repeated parameter arrives as an array, and an array where a string was expected is not a value this page can read.
	const { q, state: stateParam } = firstValues(await searchParams)
	// An unknown state in the URL reads as "Everyone" rather than an error.
	const state: UserState = USER_STATES.find(value => value === stateParam) ?? "all"

	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const page = await listUsers({ limit: 50, q, state }, { includePii })
	const rows = page.items.map(toDirectoryRow)

	return (
		<div className="hl-stack">
			<PageHeader compact title="Users" />

			<Panel>
				<nav aria-label="Filter by account state" className="hl-chips">
					{USER_STATES.map(value => (
						<Link
							aria-current={value === state ? "true" : undefined}
							className="hl-chip"
							href={directoryHref(value, q)}
							key={value}
						>
							{STATE_LABELS[value]}
						</Link>
					))}
				</nav>
				<form className="hl-row" method="get">
					{state === "all" ? null : <input name="state" type="hidden" value={state} />}
					<TextInput
						defaultValue={q ?? ""}
						name="q"
						placeholder={includePii ? "Search by name, email or Slack ID" : "Search by name"}
						style={{ maxWidth: "24rem" }}
					/>
					<Button type="submit">
						<IconSearch /> Search
					</Button>
					<ClipboardSearchButton path="/admin/users" />
				</form>
			</Panel>

			<Panel>
				{/* Keyed on the filter, so a new search starts a new list rather than appending to the old one. */}
				<UserDirectory
					initialCursor={page.nextCursor}
					initialRows={rows}
					key={`${q ?? ""}|${state}`}
					q={q ?? ""}
					state={state}
				/>
			</Panel>
		</div>
	)
}
