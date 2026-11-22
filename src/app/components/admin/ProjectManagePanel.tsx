"use client"

import { ProjectControls } from "@/app/components/admin/ProjectControls"
import { ManageSection } from "@/app/components/admin/ProjectManage"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { BomSyncForm } from "@/app/components/forms/BomSyncForm"
import { GrantForm } from "@/app/components/forms/GrantForm"
import { JournalHoursEditor, type JournalHoursEntry } from "@/app/components/forms/JournalHoursEditor"
import { CREDIT_NAME_PLURAL } from "@/lib/config/program"
import type { Theme } from "@/lib/enums"

/** What a project's manage panel acts on. Both the projects list and a user's themed projects hand this to the same panel. */
export interface ProjectManageData {
	buildStatus: string
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
	/** The owner-wide extension, already formatted, when one is running. */
	userExtension?: string | null
}

/** Which controls this viewer may use. The server checks every action again; these only decide what is offered. */
export interface ProjectManageFlags {
	canEditHours: boolean
	canExtend: boolean
	canMoveTheme: boolean
	canOverride: boolean
	canSendGrant: boolean
	/** Pull the parts list from the repo, and put a pull back. */
	canSyncBom: boolean
}

/** Whether a phase is one the maker can hand in from here: not yet handed in, or sent back to fix. */
function canHandIn(status: string): boolean {
	return status === "draft" || status === "update_requested"
}

/** Which sections a project's panel would draw. A manage button is only offered when this is true. */
export function hasProjectActions(data: ProjectManageData, flags: ProjectManageFlags): boolean {
	return (
		flags.canExtend
		|| flags.canMoveTheme
		|| (flags.canSendGrant && grantAvailable(data))
		|| flags.canSyncBom
		|| (flags.canEditHours && data.journal.length > 0)
		|| (flags.canOverride && overrideAvailable(data))
	)
}

/** Any phase an admin can un-approve, withdraw or force in. */
function overrideAvailable(data: ProjectManageData): boolean {
	return [data.designStatus, data.buildStatus].some(
		status => status === "approved" || status === "in_review" || canHandIn(status),
	)
}

function grantAvailable(data: ProjectManageData): boolean {
	return data.designStatus === "approved" && Boolean(data.grantUsd) && !data.grantSent
}

/**
 * Every section a project's manage panel can show, in one order. The panel is drawn inside a manage row by whichever table the project sits in, so the controls an admin finds are the same wherever a project appears.
 */
export function ProjectManageSections({
	data,
	flags,
}: Readonly<{ data: ProjectManageData; flags: ProjectManageFlags }>) {
	const grantAction = flags.canSendGrant && grantAvailable(data)
	const designOverride = flags.canOverride && data.designStatus === "approved"
	const buildOverride = flags.canOverride && data.buildStatus === "approved"
	const hoursAction = flags.canEditHours && data.journal.length > 0
	const designWithdraw = flags.canOverride && data.designStatus === "in_review"
	const buildWithdraw = flags.canOverride && data.buildStatus === "in_review"
	// Once a phase is in review, the withdraw section is the route; before that, force submit hands it in.
	const designForce = flags.canOverride && canHandIn(data.designStatus)
	const buildForce = flags.canOverride && canHandIn(data.buildStatus)

	return (
		<>
			{grantAction ? (
				<ManageSection title="Send grant">
					<GrantForm alreadySent={data.grantSent} amountUsd={data.grantUsd ?? 0} projectId={data.id} />
				</ManageSection>
			) : null}
			<ProjectControls
				canExtend={flags.canExtend}
				canMoveTheme={flags.canMoveTheme}
				extension={data.extension}
				projectId={data.id}
				starterProjectId={data.starterProjectId}
				theme={data.theme}
				userExtension={data.userExtension}
			/>
			{flags.canSyncBom ? (
				<ManageSection title="Parts list">
					<BomSyncForm projectId={data.id} />
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
						Takes the hand-in back, so the maker can edit it. A reviewer who holds it right now blocks this until their
						claim expires.
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
		</>
	)
}
