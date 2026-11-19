import type { Metadata } from "next"
import Link from "next/link"
import {
	Button,
	EmptyState,
	Field,
	FilterBar,
	PageHeader,
	Panel,
	Select,
	statusLabel,
	Table,
	TextInput,
} from "@/app/components/ui"
import { IconSearch } from "@/app/components/ui/icons"
import { THEMES, themeLabel } from "@/lib/config/program"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import { PhaseStatus, Theme } from "@/lib/enums"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import { listProjects, type ProjectFilters } from "@/lib/queries/admin"
import { type FirstValues, firstValues, type SearchParamValue } from "@/lib/search-params"
import { ProjectRow } from "./ProjectRow"

export const metadata: Metadata = {
	title: "Projects",
}

export const dynamic = "force-dynamic"

interface Search {
	build?: SearchParamValue
	cursor?: SearchParamValue
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

const status = (v?: string) => STATUSES.find(x => x === v)

/** Anything unrecognised in the query string is dropped, not trusted. */
function filtersFrom(s: FirstValues<Search>): ProjectFilters {
	const tier = Number(s.tier)
	return {
		buildStatus: status(s.build),
		designStatus: status(s.design),
		extended: s.extended === "1",
		q: s.q?.trim() || undefined,
		theme: Object.values(Theme).find(t => t === s.theme),
		tier: tier === 1 || tier === 2 || tier === 3 ? tier : undefined,
		unstarted: s.unstarted === "1",
	}
}

export default async function AdminProjectsPage({ searchParams }: Props) {
	const { roles } = await requirePermissionPage(Permission.VIEW_USERS)
	// Every filter, taken as the single value the URL named: a repeated parameter arrives as an array, and an array where Prisma expects a string is a 500.
	const search = firstValues(await searchParams)
	const filters = filtersFrom(search)
	const canExtend = hasPermission(roles, Permission.MANAGE_USERS)
	const canMoveTheme = hasPermission(roles, Permission.MANAGE_PROGRAM)
	// The owner's email and Slack ID are contact details: they leave the server for ADMIN/AUDITOR only, exactly as the user directory does.
	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	const { items, nextCursor } = await listProjects({ ...filters, cursor: search.cursor, limit: 50 }, { includePii })

	// The next page keeps every filter; only the cursor moves.
	const nextParams = new URLSearchParams(
		Object.entries({ ...search, cursor: nextCursor ?? undefined }).filter(
			(e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
		),
	)
	const now = new Date()

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
				{items.length === 0 ? (
					<EmptyState>No projects match.</EmptyState>
				) : (
					<Table
						className="hl-table--roomy hl-table--projects"
						head={["Project", "Owner", "Theme", "Tier", "Review", canExtend || canMoveTheme ? "Actions" : "Extension"]}
					>
						{items.map(project => {
							const userExtension =
								project.user.submissionExtensionUntil && project.user.submissionExtensionUntil > now
									? formatUtcDateTime(project.user.submissionExtensionUntil)
									: null
							return (
								<ProjectRow
									canExtend={canExtend}
									canMoveTheme={canMoveTheme}
									data={{
										buildStatus: project.buildStatus,
										designStatus: project.designStatus,
										extension: project.submissionExtensionUntil?.toISOString() ?? null,
										extensionLabel: project.submissionExtensionUntil
											? formatUtcDateTime(project.submissionExtensionUntil)
											: null,
										githubRepo: project.githubRepo,
										id: project.id,
										ownerId: project.user.id,
										ownerName: displayName(project.user) ?? "-",
										requestedTier: project.requestedTier,
										starterProjectId: project.starterProjectId,
										theme: project.theme,
										themeLabel: themeLabel(project.theme),
										tier: project.tier,
										title: project.title,
										userExtension,
									}}
									key={project.id}
								/>
							)
						})}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link href={`/admin/projects?${nextParams.toString()}`}>Next page</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
