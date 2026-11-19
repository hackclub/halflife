"use client"

import Link from "next/link"
import { useState } from "react"
import { ManageButton, ManageRow, ManageSection } from "@/app/components/admin/ProjectManage"
import { ReviewStages } from "@/app/components/admin/ReviewStages"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { GrantForm } from "@/app/components/forms/GrantForm"
import { JournalHoursEditor, type JournalHoursEntry } from "@/app/components/forms/JournalHoursEditor"
import { StarterForm } from "@/app/components/forms/StarterForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import { starterProjectsFor } from "@/lib/config/onboarding"
import { CREDIT_NAME_PLURAL } from "@/lib/config/program"
import type { Theme } from "@/lib/enums"
import type { FundingState } from "@/lib/funding-state"

/** One themed project on a participant's admin page. */
export interface ThemedProjectRowData {
	approvedHours: number | null
	buildStatus: string
	cardGrantSent: boolean
	/** Where an approved design's money stands, when it has a grant to wait on. */
	designFunding: FundingState | null
	designStatus: string
	/** ISO string, so the extension form edits the same instant the server holds. */
	extension: string | null
	grantSent: boolean
	grantUsd: number | null
	id: string
	/** The project's live journal entries, so an admin can correct a claim that was submitted wrong. */
	journal: JournalHoursEntry[]
	starterProjectId: string | null
	theme: Theme
	themeLabel: string
	tier: number | null
	title: string
}

/** Whether a phase is one the maker can hand in from here: not yet handed in, or sent back to fix. */
function canHandIn(status: string): boolean {
	return status === "draft" || status === "update_requested"
}

export function ThemedProjectRow({
	canEditHours,
	canExtend,
	canMoveTheme,
	canOverride,
	canSendGrant,
	data,
}: Readonly<{
	canEditHours: boolean
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
	const hoursAction = canEditHours && data.journal.length > 0
	const designWithdraw = canOverride && data.designStatus === "in_review"
	const buildWithdraw = canOverride && data.buildStatus === "in_review"
	// A phase the maker has not handed in, or has been asked to fix. Once it is in review, the withdraw section above is the route.
	const designForce = canOverride && canHandIn(data.designStatus)
	const buildForce = canOverride && canHandIn(data.buildStatus)
	const hasActions =
		canExtend
		|| canMoveTheme
		|| grantAction
		|| designOverride
		|| buildOverride
		|| hoursAction
		|| designWithdraw
		|| buildWithdraw
		|| designForce
		|| buildForce

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
					{data.cardGrantSent ? <div className="hl-hint">card grant issued</div> : null}
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
				{canMoveTheme && starterProjectsFor(data.theme).length > 0 ? (
					<ManageSection title="Starter project">
						<StarterForm current={data.starterProjectId} projectId={data.id} theme={data.theme} />
					</ManageSection>
				) : null}
				{canExtend ? (
					<ManageSection title="Extension">
						<ExtensionForm current={data.extension} url={`/api/admin/theme-projects/${data.id}`} />
					</ManageSection>
				) : null}
				{hoursAction ? (
					<ManageSection title="Journal hours">
						<JournalHoursEditor entries={data.journal} />
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
				{designWithdraw || buildWithdraw ? (
					<ManageSection title="Withdraw from review">
						<p className="hl-hint" style={{ marginTop: 0 }}>
							Takes the hand-in back, so the maker can edit it. A reviewer who holds it right now blocks this until
							their claim expires.
						</p>
						<div className="hl-stack hl-stack--tight">
							{designWithdraw ? (
								<ActionButton
									body={{ phase: "DESIGN" }}
									confirm="Withdraw the design from review? The reviewer's place in the queue is lost."
									label="Withdraw design"
									reasonPrompt="Why is this design being withdrawn from review?"
									url={`/api/admin/theme-projects/${data.id}/unsubmit`}
								/>
							) : null}
							{buildWithdraw ? (
								<ActionButton
									body={{ phase: "BUILD" }}
									confirm="Withdraw the build from review? The reviewer's place in the queue is lost."
									label="Withdraw build"
									reasonPrompt="Why is this build being withdrawn from review?"
									url={`/api/admin/theme-projects/${data.id}/unsubmit`}
								/>
							) : null}
						</div>
					</ManageSection>
				) : null}
				{designForce || buildForce ? (
					<ManageSection title="Force submit">
						<p className="hl-hint" style={{ marginTop: 0 }}>
							Hands the phase in for the maker, past the submissions window, the opening date of the week and the repo
							checks. Any parts shortfall still needs the maker to agree to it themselves.
						</p>
						<div className="hl-stack hl-stack--tight">
							{designForce ? (
								<ActionButton
									body={{ phase: "DESIGN" }}
									confirm="Hand the design in for the maker, past the timing gates?"
									label="Force submit design"
									reasonPrompt="Why is this design being handed in for the maker?"
									url={`/api/admin/theme-projects/${data.id}/submit`}
								/>
							) : null}
							{buildForce ? (
								<ActionButton
									body={{ phase: "BUILD" }}
									confirm="Hand the build in for the maker, past the timing gates?"
									label="Force submit build"
									reasonPrompt="Why is this build being handed in for the maker?"
									url={`/api/admin/theme-projects/${data.id}/submit`}
								/>
							) : null}
						</div>
					</ManageSection>
				) : null}
			</ManageRow>
		</>
	)
}
