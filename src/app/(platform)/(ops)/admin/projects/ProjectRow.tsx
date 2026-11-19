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

export function ProjectRow({ data, flags }: Readonly<{ data: ProjectRowData; flags: ProjectManageFlags }>) {
	const [open, setOpen] = useState(false)
	const panelId = `manage-${data.id}`
	const hasActions = hasProjectActions(data, flags)
	const tier = data.tier ?? (data.requestedTier ? `${data.requestedTier} (asked)` : "-")

	return (
		<>
			<tr>
				<td className="hl-col-project">
					<span className="hl-entity-name">{data.title || "Untitled"}</span>
					{/* The participant's project page opens for its owner only, so the admin link goes to the owner's page, where the project is listed. The public link is the read-only project page. */}
					<div className="hl-entity-links">
						<Link href={`/admin/users/${data.ownerId}?tab=projects#project-${data.id}`}>Admin project</Link>
						<Link href={`/projects/${data.id}`}>Public project</Link>
					</div>
					{/* One line for where the project lives: its repository when it has one, otherwise its ID. The full ID stays in the tooltip. */}
					<div className="hl-hint hl-mono" title={data.id}>
						{data.githubRepo ? data.githubRepo.replace(/^https:\/\/github\.com\//, "") : data.id}
					</div>
				</td>
				<td className="hl-col-owner">
					<span className="hl-entity-name">{data.ownerName}</span>
					<div className="hl-entity-links">
						<Link href={`/admin/users/${data.ownerId}`}>Admin user</Link>
						<Link href={`/u/${data.ownerId}`}>Public profile</Link>
					</div>
				</td>
				<td className="hl-col-theme">{data.themeLabel}</td>
				<td>{tier}</td>
				<td className="hl-col-review">
					<ReviewStages buildStatus={data.buildStatus} designStatus={data.designStatus} />
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
