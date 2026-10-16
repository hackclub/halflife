import Link from "next/link"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import { Badge, EmptyState, PageHeader, Panel, statusLabel, statusTone, Table } from "@/app/components/ui"
import { PhaseStatus, Theme } from "@/app/generated/prisma/enums"
import { getThemeDef, THEMES } from "@/lib/config/program"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { listProjects, type ProjectFilters } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

interface Search {
	build?: string
	cursor?: string
	design?: string
	extended?: string
	q?: string
	theme?: string
	tier?: string
	unstarted?: string
}
interface Props {
	searchParams: Promise<Search>
}

const STATUSES = Object.values(PhaseStatus)

/** Anything unrecognised in the query string is dropped, not trusted. */
function filtersFrom(s: Search): ProjectFilters {
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
	const search = await searchParams
	const filters = filtersFrom(search)
	const canExtend = hasPermission(roles, Permission.MANAGE_USERS)
	const canMoveTheme = hasPermission(roles, Permission.MANAGE_PROGRAM)

	const { items, nextCursor } = await listProjects({ ...filters, cursor: search.cursor, limit: 50 })

	// The next page keeps every filter; only the cursor moves.
	const nextParams = new URLSearchParams(
		Object.entries({ ...search, cursor: nextCursor ?? undefined }).filter(
			(e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
		),
	)
	const now = new Date()

	return (
		<div className="hl-stack">
			<PageHeader
				subtitle="Search by title, description, repo, project ID, or the owner's name, email or Slack ID."
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
					<Table head={["Project", "Owner", "Theme", "Design", "Build", "Tier", "Extension"]}>
						{items.map(project => {
							const userExt =
								project.user.submissionExtensionUntil && project.user.submissionExtensionUntil > now
									? project.user.submissionExtensionUntil
									: null
							return (
								<tr key={project.id}>
									<td>
										{/* The participant's project page opens for its owner only, so
                        this goes to the owner's admin page, where it is listed. */}
										<Link href={`/admin/users/${project.user.id}#project-${project.id}`}>
											{project.title || "Untitled"}
										</Link>
										<div className="hl-hint hl-mono">{project.id}</div>
										{project.githubRepo ? (
											<div className="hl-hint hl-mono">
												{project.githubRepo.replace(/^https:\/\/github\.com\//, "")}
											</div>
										) : null}
									</td>
									<td>
										<Link href={`/admin/users/${project.user.id}`}>
											{displayName(project.user, project.user.email)}
										</Link>
										<div className="hl-hint hl-mono">{project.user.slackId ?? project.user.email}</div>
									</td>
									<td>
										{getThemeDef(project.theme).label}
										{canMoveTheme ? (
											<div style={{ marginTop: "0.5rem" }}>
												<ThemeMoveForm current={project.theme} projectId={project.id} />
											</div>
										) : null}
									</td>
									<td>
										<Badge tone={statusTone(project.designStatus)}>{statusLabel(project.designStatus)}</Badge>
									</td>
									<td>
										<Badge tone={statusTone(project.buildStatus)}>{statusLabel(project.buildStatus)}</Badge>
									</td>
									<td>{project.tier ?? (project.requestedTier ? `${project.requestedTier} (asked)` : "—")}</td>
									<td style={{ minWidth: "18rem" }}>
										{canExtend ? (
											<ExtensionForm
												current={project.submissionExtensionUntil?.toISOString() ?? null}
												url={`/api/admin/theme-projects/${project.id}`}
											/>
										) : project.submissionExtensionUntil ? (
											<span className="hl-mono">{project.submissionExtensionUntil.toLocaleString()}</span>
										) : (
											"—"
										)}
										{userExt ? <div className="hl-hint">Owner extended until {userExt.toLocaleString()}</div> : null}
									</td>
								</tr>
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
