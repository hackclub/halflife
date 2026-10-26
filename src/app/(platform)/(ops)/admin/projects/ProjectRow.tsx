"use client"

import Link from "next/link"
import { useState } from "react"
import { ManageButton, ManageRow, ManageSection } from "@/app/components/admin/ProjectManage"
import { ReviewStages } from "@/app/components/admin/ReviewStages"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import type { Theme } from "@/lib/enums"

/** One project row, with the controls folded into a panel under it. */
export interface ProjectRowData {
	buildStatus: string
	designStatus: string
	/** ISO string, so the extension form edits the same instant the server holds. */
	extension: string | null
	/** The same instant, already formatted for display. */
	extensionLabel: string | null
	githubRepo: string | null
	id: string
	ownerId: string
	ownerName: string
	requestedTier: number | null
	theme: Theme
	themeLabel: string
	tier: number | null
	title: string
	/** The owner-wide extension, already formatted, when one is running. */
	userExtension: string | null
}

export function ProjectRow({
	canExtend,
	canMoveTheme,
	data,
}: Readonly<{ canExtend: boolean; canMoveTheme: boolean; data: ProjectRowData }>) {
	const [open, setOpen] = useState(false)
	const canManage = canExtend || canMoveTheme
	const panelId = `manage-${data.id}`
	const tier = data.tier ?? (data.requestedTier ? `${data.requestedTier} (asked)` : "-")

	return (
		<>
			<tr>
				<td style={{ minWidth: "16rem", overflowWrap: "anywhere" }}>
					<span className="hl-entity-name">{data.title || "Untitled"}</span>
					{/* The participant's project page opens for its owner only, so the admin link goes to the owner's page, where the project is listed. The public link is the read-only project page. */}
					<div className="hl-entity-links">
						<Link href={`/admin/users/${data.ownerId}#project-${data.id}`}>Admin project</Link>
						<Link href={`/projects/${data.id}`}>Public project</Link>
					</div>
					<div className="hl-hint hl-mono">{data.id}</div>
					{data.githubRepo ? (
						<div className="hl-hint hl-mono">{data.githubRepo.replace(/^https:\/\/github\.com\//, "")}</div>
					) : null}
				</td>
				<td style={{ minWidth: "13rem", overflowWrap: "anywhere" }}>
					<span className="hl-entity-name">{data.ownerName}</span>
					<div className="hl-entity-links">
						<Link href={`/admin/users/${data.ownerId}`}>Admin user</Link>
						<Link href={`/u/${data.ownerId}`}>Public profile</Link>
					</div>
				</td>
				<td style={{ minWidth: "9rem" }}>{data.themeLabel}</td>
				<td>{tier}</td>
				<td style={{ minWidth: "14rem" }}>
					<ReviewStages buildStatus={data.buildStatus} designStatus={data.designStatus} />
				</td>
				<td style={{ minWidth: "13rem" }}>
					{canManage ? (
						<div className="hl-stack hl-stack--tight">
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
			<ManageRow id={panelId} open={open}>
				{canMoveTheme ? (
					<ManageSection title="Move to theme">
						<ThemeMoveForm current={data.theme} projectId={data.id} />
					</ManageSection>
				) : null}
				{canExtend ? (
					<ManageSection title="Extension">
						<ExtensionForm current={data.extension} url={`/api/admin/theme-projects/${data.id}`} />
						{data.userExtension ? <p className="hl-hint">Owner extended until {data.userExtension}</p> : null}
					</ManageSection>
				) : null}
			</ManageRow>
		</>
	)
}
