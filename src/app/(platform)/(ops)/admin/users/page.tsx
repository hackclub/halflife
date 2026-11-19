import type { Metadata } from "next"
import { ClipboardSearchButton } from "@/app/components/admin/ClipboardSearchButton"
import { UserDirectory } from "@/app/components/admin/UserDirectory"
import { Field, FilterBar, PageHeader, Panel, Select, TextInput } from "@/app/components/ui"
import { toDirectoryRow } from "@/lib/directory-rows"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasRole, Permission, Role } from "@/lib/permissions"
import { listUsers, USER_STATES, type UserState } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"

export const metadata: Metadata = {
	title: "Users",
}

export const dynamic = "force-dynamic"

interface Props {
	searchParams: Promise<{ q?: SearchParamValue; state?: SearchParamValue; verified?: SearchParamValue }>
}

/** The account-state choices, in the order an admin is most likely to want them. */
const STATE_LABELS: { [_ in UserState]: string } = {
	all: "Everyone",
	banned: "Banned",
	flagged: "Fraud flagged",
	suspended: "Suspended",
	unverified: "Not verified",
}

/** HCA's identity statuses as the directory's badge names them. "unknown" is an account HCA has never answered for. */
const VERIFIED_LABELS: { [_: string]: string } = {
	ineligible: "Ineligible",
	needs_submission: "Needs submission",
	pending: "Pending",
	unknown: "Never asked",
	verified: "Verified",
}

export default async function AdminUsersPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	// Each filter is taken as the single value the URL named: a repeated parameter arrives as an array, and an array where a string was expected is not a value this page can read.
	const { q, state: stateParam, verified: verifiedParam } = firstValues(await searchParams)
	// An unknown state in the URL reads as "Everyone" rather than an error, and an unknown identity status is dropped.
	const state: UserState = USER_STATES.find(value => value === stateParam) ?? "all"
	const verified = verifiedParam !== undefined && Object.hasOwn(VERIFIED_LABELS, verifiedParam) ? verifiedParam : ""

	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const page = await listUsers({ limit: 50, q, state, verified: verified || undefined }, { includePii })
	const rows = page.items.map(toDirectoryRow)

	return (
		<div className="hl-stack">
			<PageHeader compact title="Users" />

			<Panel>
				<FilterBar
					leading={
						<div className="hl-filters__search">
							<TextInput
								aria-label="Search users"
								defaultValue={q ?? ""}
								name="q"
								placeholder={includePii ? "Search by name, email or Slack ID" : "Search by name"}
							/>
							<ClipboardSearchButton path="/admin/users" />
						</div>
					}
					resetHref="/admin/users"
				>
					<Field label="Account state">
						<Select defaultValue={state} name="state">
							{USER_STATES.map(value => (
								<option key={value} value={value}>
									{STATE_LABELS[value]}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Identity status">
						<Select defaultValue={verified} name="verified">
							<option value="">Any status</option>
							{Object.entries(VERIFIED_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</Select>
					</Field>
				</FilterBar>
			</Panel>

			<Panel>
				{/* Keyed on the filters, so a new search starts a new list rather than appending to the old one. */}
				<UserDirectory
					initialCursor={page.nextCursor}
					initialRows={rows}
					key={`${q ?? ""}|${state}|${verified}`}
					q={q ?? ""}
					state={state}
					verified={verified}
				/>
			</Panel>
		</div>
	)
}
