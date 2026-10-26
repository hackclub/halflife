"use client"

import Link from "next/link"
import { useState } from "react"
import { ManageButton, ManageRow, ManageSection } from "@/app/components/admin/ProjectManage"
import { ReviewStages } from "@/app/components/admin/ReviewStages"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { GrantForm } from "@/app/components/forms/GrantForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import { CREDIT_NAME_PLURAL } from "@/lib/config/program"
import type { Theme } from "@/lib/enums"

/** One themed project on a participant's admin page. */
export interface ThemedProjectRowData {
	approvedHours: number | null
	buildStatus: string
	designStatus: string
	/** ISO string, so the extension form edits the same instant the server holds. */
	extension: string | null
	grantSent: boolean
	grantUsd: number | null
	id: string
	theme: Theme
	themeLabel: string
	tier: number | null
	title: string
}

export function ThemedProjectRow({
	canExtend,
	canMoveTheme,
	canOverride,
	canSendGrant,
	data,
}: Readonly<{
	canExtend: boolean
	canMoveTheme: boolean
	canOverride: boolean
	canSendGrant: boolean
	data: ThemedProjectRowData
}>) {
	const [open, setOpen] = useState(false)
	const panelId = `manage-${data.id}`
	const grantAction = canSendGrant && data.designStatus === "approved" && Boolean(data.grantUsd) && !data.grantSent
	const designOverride = canOverride && data.designStatus === "approved"
	const buildOverride = canOverride && data.buildStatus === "approved"
	const hasActions = canExtend || canMoveTheme || grantAction || designOverride || buildOverride

	return (
		<>
			<tr id={`project-${data.id}`}>
				<td style={{ minWidth: "15rem", overflowWrap: "anywhere" }}>
					<span className="hl-entity-name">{data.themeLabel}</span>
					<div className="hl-hint">{data.title}</div>
					<div className="hl-entity-links">
						<Link href={`/projects/${data.id}`}>Public project</Link>
					</div>
				</td>
				<td style={{ minWidth: "14rem" }}>
					<ReviewStages buildStatus={data.buildStatus} designStatus={data.designStatus} />
				</td>
				<td>{data.tier ?? "-"}</td>
				<td>
					{data.grantUsd !== null ? `$${data.grantUsd}` : "-"}
					{data.grantSent ? <div className="hl-hint">sent</div> : null}
				</td>
				<td className="hl-mono">{data.approvedHours ?? "-"}</td>
				<td style={{ minWidth: "13rem" }}>
					{hasActions ? (
						<ManageButton onToggle={() => setOpen(value => !value)} open={open} panelId={panelId} />
					) : (
						<span className="hl-muted">-</span>
					)}
				</td>
			</tr>
			<ManageRow id={panelId} open={open && hasActions}>
				{grantAction ? (
					<ManageSection title="Send grant">
						<GrantForm alreadySent={data.grantSent} amountUsd={data.grantUsd ?? 0} projectId={data.id} />
					</ManageSection>
				) : null}
				{canMoveTheme ? (
					<ManageSection title="Move to theme">
						<ThemeMoveForm current={data.theme} projectId={data.id} />
					</ManageSection>
				) : null}
				{canExtend ? (
					<ManageSection title="Extension">
						<ExtensionForm current={data.extension} url={`/api/admin/theme-projects/${data.id}`} />
					</ManageSection>
				) : null}
				{designOverride || buildOverride ? (
					<ManageSection title="Override a decision">
						<div className="hl-stack hl-stack--tight">
							{designOverride ? (
								<ActionButton
									body={{
										action: "unapprove",
										phase: "DESIGN",
										reason: "Un-approved by an admin",
									}}
									confirm="Un-approve the design? This clears the tier and grant."
									label="Un-approve design"
									url={`/api/admin/theme-projects/${data.id}/override`}
								/>
							) : null}
							{buildOverride ? (
								<ActionButton
									body={{
										action: "unapprove",
										phase: "BUILD",
										reason: "Un-approved by an admin",
									}}
									confirm={`Un-approve the build? This reconciles their ${CREDIT_NAME_PLURAL} back down.`}
									label="Un-approve build"
									url={`/api/admin/theme-projects/${data.id}/override`}
								/>
							) : null}
						</div>
					</ManageSection>
				) : null}
			</ManageRow>
		</>
	)
}
