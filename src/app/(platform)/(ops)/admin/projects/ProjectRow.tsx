"use client"

import Link from "next/link"
import { useState } from "react"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import { Badge, Button, statusLabel, statusTone } from "@/app/components/ui"
import type { Theme } from "@/app/generated/prisma/enums"

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
	ownerEmail: string
	ownerId: string
	ownerName: string
	ownerSlackId: string | null
	requestedTier: number | null
	theme: Theme
	themeLabel: string
	tier: number | null
	title: string
	/** The owner-wide extension, already formatted, when one is running. */
	userExtension: string | null
}

/** Design is drawn as a pencil and build as a hammer: the stage survives a colour-blind read and a monochrome print. */
function DesignIcon() {
	return (
		<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
			<path
				d="m4 20 1.1-4.2L16.4 4.5a2.1 2.1 0 0 1 3 3L8.1 18.9 4 20Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
			<path d="m14.6 6.3 3.1 3.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
		</svg>
	)
}

function BuildIcon() {
	return (
		<svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
			<path
				d="m13.6 5.2 5.2 5.2-2.1 2.1-5.2-5.2 2.1-2.1Z"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
			<path
				d="M12.7 8.1 4 17v3h3l8.9-8.7"
				stroke="currentColor"
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth="1.8"
			/>
		</svg>
	)
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={open ? "hl-manage-chevron hl-manage-chevron--open" : "hl-manage-chevron"}
			fill="none"
			viewBox="0 0 24 24"
		>
			<path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
		</svg>
	)
}

export function ProjectRow({
	canExtend,
	canMoveTheme,
	data,
}: Readonly<{ canExtend: boolean; canMoveTheme: boolean; data: ProjectRowData }>) {
	const [open, setOpen] = useState(false)
	const canManage = canExtend || canMoveTheme
	const panelId = `manage-${data.id}`
	const tier = data.tier ?? (data.requestedTier ? `${data.requestedTier} (asked)` : "—")

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
					<div className="hl-hint hl-mono">{data.ownerSlackId ?? data.ownerEmail}</div>
				</td>
				<td style={{ minWidth: "9rem" }}>{data.themeLabel}</td>
				<td>{tier}</td>
				<td style={{ minWidth: "14rem" }}>
					<ul className="hl-review-stages">
						<li>
							<DesignIcon />
							<span className="hl-review-stages__name">Design</span>
							<Badge tone={statusTone(data.designStatus)}>{statusLabel(data.designStatus)}</Badge>
						</li>
						<li>
							<BuildIcon />
							<span className="hl-review-stages__name">Build</span>
							<Badge tone={statusTone(data.buildStatus)}>{statusLabel(data.buildStatus)}</Badge>
						</li>
					</ul>
				</td>
				<td style={{ minWidth: "13rem" }}>
					{canManage ? (
						<div className="hl-stack hl-stack--tight">
							<Button
								aria-controls={panelId}
								aria-expanded={open}
								onClick={() => setOpen(value => !value)}
								type="button"
							>
								Manage
								<Chevron open={open} />
							</Button>
							{data.userExtension ? <span className="hl-hint">Owner extended until {data.userExtension}</span> : null}
						</div>
					) : data.extensionLabel ? (
						<span className="hl-mono">{data.extensionLabel}</span>
					) : (
						<span className="hl-muted">No extension</span>
					)}
				</td>
			</tr>
			{open ? (
				<tr className="hl-manage-row" id={panelId}>
					<td colSpan={6}>
						<div className="hl-manage-panel">
							{canMoveTheme ? (
								<section>
									<h3>Move to theme</h3>
									<ThemeMoveForm current={data.theme} projectId={data.id} />
								</section>
							) : null}
							{canExtend ? (
								<section>
									<h3>Extension</h3>
									<ExtensionForm current={data.extension} url={`/api/admin/theme-projects/${data.id}`} />
									{data.userExtension ? <p className="hl-hint">Owner extended until {data.userExtension}</p> : null}
								</section>
							) : null}
						</div>
					</td>
				</tr>
			) : null}
		</>
	)
}
