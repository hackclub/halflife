import type { Metadata } from "next"
import { Button, Field, FilterBar, PageHeader, Panel, Select, statusLabel, TextInput } from "@/app/components/ui"
import { IconSearch } from "@/app/components/ui/icons"
import { THEMES, themeLabel } from "@/lib/config/program"
import { PhaseStatus, Theme } from "@/lib/enums"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { PROJECT_PAGE_SIZE, projectAccessFor, projectFiltersFrom, toProjectRow } from "@/lib/project-directory"
import { listProjects } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { ProjectList } from "./ProjectList"

export const metadata: Metadata = {
	title: "Projects",
}

export const dynamic = "force-dynamic"

interface Search {
	build?: SearchParamValue
	design?: SearchParamValue
	extended?: SearchParamValue
	q?: SearchParamValue
	theme?: SearchParamValue
	tier?: SearchParamValue
	unstarted?: SearchParamValue
}
interface Props {
	searchParams: Promise<Search>
}

const STATUSES = Object.values(PhaseStatus)

export default async function AdminProjectsPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	// Every filter, taken as the single value the URL named: a repeated parameter arrives as an array, and an array where Prisma expects a string is a 500.
	const search = firstValues(await searchParams)
	const filters = projectFiltersFrom(search)
	const { flags, includePii } = projectAccessFor(roles)
	// oxlint-disable-next-line react/purity -- async server page, rendered once per request, so this time is never reused
	const now = new Date()
	const { items, nextCursor } = await listProjects({ ...filters, limit: PROJECT_PAGE_SIZE }, { includePii })
	const rows = items.map(project => toProjectRow(project, now))

	// The rows below load more through the same filters, so the list's address carries them all.
	const listParams = new URLSearchParams(
		Object.entries({
			build: search.build,
			design: search.design,
			extended: search.extended,
			q: search.q,
			theme: search.theme,
			tier: search.tier,
			unstarted: search.unstarted,
		}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
	)
	const filterKey = listParams.toString()
	listParams.set("limit", String(PROJECT_PAGE_SIZE))

	return (
		<div className="hl-stack hl-page-wide">
			<PageHeader
				compact
				subtitle={
					includePii
						? "Search by title, description, repo, project ID, or the owner's name, email or Slack ID."
						: "Search by title, description, repo, project ID, or the owner's name."
				}
				title="Projects"
			/>

			<Panel>
				<FilterBar
					footer={
						<div className="hl-filters__toggles">
							<label>
								<input defaultChecked={filters.extended} name="extended" type="checkbox" value="1" />
								Extension running
							</label>
							<label>
								<input defaultChecked={filters.unstarted} name="unstarted" type="checkbox" value="1" />
								Include unstarted
							</label>
						</div>
					}
					leading={
						/* The search is the one thing most lookups start with, so it gets its own row and the only primary button. */
						<div className="hl-filters__search">
							<TextInput
								aria-label="Search projects or owners"
								defaultValue={search.q ?? ""}
								name="q"
								placeholder="Search projects or owners"
							/>
							<Button type="submit">
								<IconSearch /> Search
							</Button>
						</div>
					}
					resetHref="/admin/projects"
				>
					<Field label="Theme">
						<Select defaultValue={filters.theme ?? ""} name="theme">
							<option value="">Any theme</option>
							{THEMES.map(t => (
								<option key={t.id} value={t.id}>
									{themeLabel(t.id)}
								</option>
							))}
							<option value={Theme.WARMUP}>Warm Up</option>
						</Select>
					</Field>
					<Field label="Design stage">
						<Select defaultValue={filters.designStatus ?? ""} name="design">
							<option value="">Any status</option>
							{STATUSES.map(s => (
								<option key={s} value={s}>
									{statusLabel(s)}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Build stage">
						<Select defaultValue={filters.buildStatus ?? ""} name="build">
							<option value="">Any status</option>
							{STATUSES.map(s => (
								<option key={s} value={s}>
									{statusLabel(s)}
								</option>
							))}
						</Select>
					</Field>
					<Field label="Tier">
						<Select defaultValue={filters.tier ? String(filters.tier) : ""} name="tier">
							<option value="">Any tier</option>
							<option value="1">Tier 1</option>
							<option value="2">Tier 2</option>
							<option value="3">Tier 3</option>
						</Select>
					</Field>
				</FilterBar>
			</Panel>

			<Panel>
				{/* Keyed on the filters, so a new search starts a new list rather than appending to the old one. */}
				<ProjectList
					baseUrl={`/api/admin/projects?${listParams}`}
					filters={filterKey}
					flags={flags}
					initialCursor={nextCursor}
					initialRows={rows}
					key={filterKey}
				/>
			</Panel>
		</div>
	)
}
