"use client"

import Link from "next/link"
import { useState } from "react"
import { ManageButton, ManageRow } from "@/app/components/admin/ProjectManage"
import {
	hasProjectActions,
	type ProjectManageData,
	type ProjectManageFlags,
	ProjectManageSections,
} from "@/app/components/admin/ProjectManagePanel"
import { ReviewStages } from "@/app/components/admin/ReviewStages"

/** One project row, with the controls folded into a panel under it. */
export interface ProjectRowData extends ProjectManageData {
	/** The same instant as `extension`, already formatted for display. */
	extensionLabel: string | null
	githubRepo: string | null
	ownerId: string
	ownerName: string
	requestedTier: number | null
	themeLabel: string
	tier: number | null
	title: string
}

/** The projects list with one filter changed, keeping the others. */
function filteredHref(filters: string, key: string, value: string): string {
	const params = new URLSearchParams(filters)
	params.set(key, value)
	return `/admin/projects?${params.toString()}`
}

export function ProjectRow({
	data,
	filters,
	flags,
}: Readonly<{ data: ProjectRowData; filters: string; flags: ProjectManageFlags }>) {
	const [open, setOpen] = useState(false)
	const panelId = `manage-${data.id}`
	const hasActions = hasProjectActions(data, flags)
	const tierValue = data.tier ?? data.requestedTier
	const tier = data.tier ?? (data.requestedTier ? `${data.requestedTier} (asked)` : "-")

	return (
		<>
			<tr>
				<td className="hl-col-project">
					{/* The participant's project page opens for its owner only, so the name goes to the owner's page, where the project is listed. The public link is the read-only project page. */}
					<Link className="hl-entity-name" href={`/admin/users/${data.ownerId}?tab=projects#project-${data.id}`}>
						{data.title || "Untitled"}
					</Link>
					<div className="hl-entity-links">
						<Link href={`/projects/${data.id}`}>Public project</Link>
					</div>
					{/* One line for where the project lives: its repository when it has one, otherwise its ID. The full ID stays in the tooltip. */}
					<div className="hl-hint hl-mono" title={data.id}>
						{data.githubRepo ? data.githubRepo.replace(/^https:\/\/github\.com\//, "") : data.id}
					</div>
				</td>
				<td className="hl-col-owner">
					<Link className="hl-entity-name" href={`/admin/users/${data.ownerId}`}>
						{data.ownerName}
					</Link>
					<div className="hl-entity-links">
						<Link href={`/u/${data.ownerId}`}>Public profile</Link>
					</div>
				</td>
				<td className="hl-col-theme">
					<Link href={filteredHref(filters, "theme", data.theme)} title={`Show only ${data.themeLabel} projects`}>
						{data.themeLabel}
					</Link>
				</td>
				<td>
					{tierValue === null ? (
						tier
					) : (
						<Link
							href={filteredHref(filters, "tier", String(tierValue))}
							title={`Show only tier ${tierValue} projects`}
						>
							{tier}
						</Link>
					)}
				</td>
				<td className="hl-col-review">
					<ReviewStages
						buildHref={filteredHref(filters, "build", data.buildStatus)}
						buildStatus={data.buildStatus}
						designHref={filteredHref(filters, "design", data.designStatus)}
						designStatus={data.designStatus}
					/>
				</td>
				<td className="hl-col-actions">
					{hasActions ? (
						<div className="hl-row-actions">
							<ManageButton onToggle={() => setOpen(value => !value)} open={open} panelId={panelId} />
							{data.userExtension ? <span className="hl-hint">Owner extended until {data.userExtension}</span> : null}
						</div>
					) : data.extensionLabel ? (
						<span className="hl-mono">{data.extensionLabel}</span>
					) : (
						<span className="hl-muted">No extension</span>
					)}
				</td>
			</tr>
			<ManageRow id={panelId} open={open && hasActions}>
				<ProjectManageSections data={data} flags={flags} />
			</ManageRow>
		</>
	)
}
