"use client"

import Link from "next/link"
import { useState } from "react"
import { ReviewStages } from "@/app/components/admin/ReviewStages"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ExtensionForm } from "@/app/components/forms/ExtensionForm"
import { GrantForm } from "@/app/components/forms/GrantForm"
import { ThemeMoveForm } from "@/app/components/forms/ThemeMoveForm"
import { Button } from "@/app/components/ui"
import type { Theme } from "@/app/generated/prisma/enums"
import { CREDIT_NAME_PLURAL } from "@/lib/config/program"

/** One themed project on a participant's admin page. */
interface ThemedProjectRowData {
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
				<td>{data.tier ?? "—"}</td>
				<td>
					{data.grantUsd !== null ? `$${data.grantUsd}` : "—"}
					{data.grantSent ? <div className="hl-hint">sent</div> : null}
				</td>
				<td className="hl-mono">{data.approvedHours ?? "—"}</td>
				<td style={{ minWidth: "13rem" }}>
					{hasActions ? (
						<Button aria-controls={panelId} aria-expanded={open} onClick={() => setOpen(value => !value)} type="button">
							Manage
							<Chevron open={open} />
						</Button>
					) : (
						<span className="hl-muted">—</span>
					)}
				</td>
			</tr>
			{open && hasActions ? (
				<tr className="hl-manage-row" id={panelId}>
					<td colSpan={6}>
						<div className="hl-manage-panel">
							{grantAction ? (
								<section>
									<h3>Send grant</h3>
									<GrantForm alreadySent={data.grantSent} amountUsd={data.grantUsd ?? 0} projectId={data.id} />
								</section>
							) : null}
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
								</section>
							) : null}
							{designOverride || buildOverride ? (
								<section>
									<h3>Override a decision</h3>
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
								</section>
							) : null}
						</div>
					</td>
				</tr>
			) : null}
		</>
	)
}

export type { ThemedProjectRowData }
