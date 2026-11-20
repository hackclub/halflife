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
import type { FundingState } from "@/lib/funding-state"

/** One themed project on a participant's admin page. */
export interface ThemedProjectRowData extends ProjectManageData {
	approvedHours: number | null
	/** Where an approved design's money stands, when it has a grant to wait on. */
	designFunding: FundingState | null
	/** The issued card grant, when there is one: linked to its row on the grant cards page, and to its HCB grant. */
	issuedCard: { hcbCardGrantId: string | null; id: string } | null
	themeLabel: string
	tier: number | null
	title: string
}

export function ThemedProjectRow({
	flags,
	data,
}: Readonly<{
	flags: ProjectManageFlags
	data: ThemedProjectRowData
}>) {
	const [open, setOpen] = useState(false)
	const panelId = `manage-${data.id}`
	const hasActions = hasProjectActions(data, flags)

	return (
		<>
			<tr id={`project-${data.id}`}>
				<td className="hl-cell-project">
					<span className="hl-entity-name">{data.themeLabel}</span>
					<div className="hl-hint">{data.title}</div>
					<div className="hl-entity-links">
						<Link href={`/projects/${data.id}`}>Public project</Link>
					</div>
				</td>
				<td className="hl-cell-review">
					<ReviewStages
						buildStatus={data.buildStatus}
						designFunding={data.designFunding}
						designStatus={data.designStatus}
					/>
				</td>
				<td>{data.tier ?? "-"}</td>
				<td>
					{data.grantUsd === null ? "-" : `$${data.grantUsd}`}
					{data.issuedCard ? (
						<div className="hl-hint">
							<Link href={`/admin/grants?tab=issued#card-${data.issuedCard.id}`}>card grant issued</Link>
							{data.issuedCard.hcbCardGrantId ? (
								<>
									{" · "}
									<a href={`https://hcb.hackclub.com/grants/${data.issuedCard.hcbCardGrantId}`}>view on HCB</a>
								</>
							) : null}
						</div>
					) : null}
					{data.grantSent ? <div className="hl-hint">top-up sent</div> : null}
				</td>
				<td className="hl-mono">{data.approvedHours ?? "-"}</td>
				<td className="hl-cell-actions">
					{hasActions ? (
						<ManageButton onToggle={() => setOpen(value => !value)} open={open} panelId={panelId} />
					) : (
						<span className="hl-muted">-</span>
					)}
				</td>
			</tr>
			<ManageRow id={panelId} open={open && hasActions}>
				<ProjectManageSections data={data} flags={flags} />
			</ManageRow>
		</>
	)
}
