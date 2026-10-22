import Link from "next/link"
import { EmptyState, PageHeader, Panel, statusLabel, Table } from "@/app/components/ui"
import { PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { getThemeDef, THEMES } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import { listProjects, type ProjectFilters } from "@/lib/queries/admin"
import { type FirstValues, firstValues, type SearchParamValue } from "@/lib/search-params"
import { ProjectRow } from "./ProjectRow"

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

/** Anything unrecognised in the query string is dropped, not trusted. */
function filtersFrom(s: FirstValues<Search>): ProjectFilters {
	const status = (v?: string) => STATUSES.find(x => x === v)
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
				subtitle={
					includePii
						? "Search by title, description, repo, project ID, or the owner's name, email or Slack ID."
						: "Search by title, description, repo, project ID, or the owner's name."
				}
				title="Projects"
			/>

			<Panel>
				<form className="hl-row" method="get" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
					<input
						className="hl-input"
						defaultValue={search.q ?? ""}
						name="q"
						placeholder="Search projects or owners"
						style={{ maxWidth: "20rem" }}
					/>
					<select className="hl-input" defaultValue={filters.theme ?? ""} name="theme" style={{ maxWidth: "12rem" }}>
						<option value="">Any theme</option>
						{THEMES.map(t => (
							<option key={t.id} value={t.id}>
								{t.label}
							</option>
						))}
						<option value={Theme.WARMUP}>Warm Up</option>
					</select>
					<select
						className="hl-input"
						defaultValue={filters.designStatus ?? ""}
						name="design"
						style={{ maxWidth: "12rem" }}
					>
						<option value="">Design: any</option>
						{STATUSES.map(s => (
							<option key={s} value={s}>
								Design: {statusLabel(s)}
							</option>
						))}
					</select>
					<select
						className="hl-input"
						defaultValue={filters.buildStatus ?? ""}
						name="build"
						style={{ maxWidth: "12rem" }}
					>
						<option value="">Build: any</option>
						{STATUSES.map(s => (
							<option key={s} value={s}>
								Build: {statusLabel(s)}
							</option>
						))}
					</select>
					<select
						className="hl-input"
						defaultValue={filters.tier ? String(filters.tier) : ""}
						name="tier"
						style={{ maxWidth: "9rem" }}
					>
						<option value="">Any tier</option>
						<option value="1">Tier 1</option>
						<option value="2">Tier 2</option>
						<option value="3">Tier 3</option>
					</select>
					<label className="hl-row" style={{ gap: "0.35rem" }}>
						<input defaultChecked={filters.extended} name="extended" type="checkbox" value="1" />
						Extension running
					</label>
					<label className="hl-row" style={{ gap: "0.35rem" }}>
						<input defaultChecked={filters.unstarted} name="unstarted" type="checkbox" value="1" />
						Include unstarted
					</label>
					<button className="hl-btn" type="submit">
						Search
					</button>
					<Link className="hl-hint" href="/admin/projects">
						Reset
					</Link>
				</form>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>No projects match.</EmptyState>
				) : (
					<Table
						className="hl-table--roomy"
						head={["Project", "Owner", "Theme", "Tier", "Review", canExtend || canMoveTheme ? "Actions" : "Extension"]}
					>
						{items.map(project => {
							const userExtension =
								project.user.submissionExtensionUntil && project.user.submissionExtensionUntil > now
									? project.user.submissionExtensionUntil.toLocaleString()
									: null
							return (
								<ProjectRow
									canExtend={canExtend}
									canMoveTheme={canMoveTheme}
									data={{
										buildStatus: project.buildStatus,
										designStatus: project.designStatus,
										extension: project.submissionExtensionUntil?.toISOString() ?? null,
										extensionLabel: project.submissionExtensionUntil?.toLocaleString() ?? null,
										githubRepo: project.githubRepo,
										id: project.id,
										ownerId: project.user.id,
										ownerName: displayName(project.user) ?? "—",
										requestedTier: project.requestedTier,
										theme: project.theme,
										themeLabel: getThemeDef(project.theme).label,
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
