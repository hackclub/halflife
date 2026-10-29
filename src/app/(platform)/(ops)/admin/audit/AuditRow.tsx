"use client"

import Link from "next/link"
import { useState } from "react"
import {
	type AuditPayload,
	auditPayload,
	formatAuditCompact,
	formatAuditValue,
} from "@/app/components/admin/audit-payload"
import { ManageButton, ManageRow, ManageSection } from "@/app/components/admin/ProjectManage"

/** How many changed fields the closed row shows before it says how many are folded away. */
const SUMMARY_LINES = 3

/** One audit-log row, with the whole payload folded into a panel under it. */
export interface AuditRowData {
	action: string
	actorEmail: string | null
	actorId: string | null
	actorIp: string | null
	actorUserAgent: string | null
	/** Already formatted for display. */
	createdAt: string
	id: string
	metadata: unknown
	targetId: string | null
	targetType: string | null
}

/** Where a target lives in the console, when its type names a page that can look it up. */
function targetHref(targetType: string | null, targetId: string | null): string | null {
	if (!targetId) return null
	switch (targetType) {
		case "User":
			return `/admin/users/${targetId}`
		case "ThemeProject":
			return `/admin/projects?q=${encodeURIComponent(targetId)}`
		case "ProgramSettings":
			return "/admin/program"
		case null:
			return null
		default:
			return null
	}
}

/** The changed fields, or the recorded detail when the action logged no before/after pair. */
function PayloadSummary({ payload }: Readonly<{ payload: AuditPayload }>) {
	const lines =
		payload.changes.length > 0
			? payload.changes.map(change => ({
					key: change.field,
					text: `${formatAuditCompact(change.before)} → ${formatAuditCompact(change.after)}`,
				}))
			: payload.fields.map(field => ({ key: field.key, text: formatAuditCompact(field.value) }))

	if (lines.length === 0) return <span className="hl-muted">No detail</span>

	const shown = lines.slice(0, SUMMARY_LINES)
	return (
		<ul className="hl-audit-summary">
			{shown.map(line => (
				<li key={line.key}>
					<span className="hl-audit-summary-key">{line.key}</span>
					<span>{line.text}</span>
				</li>
			))}
			{lines.length > shown.length ? (
				<li className="hl-audit-summary-more">+{lines.length - shown.length} more</li>
			) : null}
		</ul>
	)
}

export function AuditRow({ data }: Readonly<{ data: AuditRowData }>) {
	const [open, setOpen] = useState(false)
	const payload = auditPayload(data.metadata)
	const panelId = `audit-${data.id}`
	const href = targetHref(data.targetType, data.targetId)
	const actor = data.actorEmail ?? data.actorId ?? "system"

	return (
		<>
			<tr>
				<td className="hl-mono">{data.createdAt}</td>
				<td className="hl-mono">{data.action}</td>
				<td className="hl-hint">{actor}</td>
				<td className="hl-mono">
					{data.targetType ?? "-"}
					{data.targetId ? <div className="hl-hint">{data.targetId}</div> : null}
				</td>
				<td style={{ minWidth: "20rem" }}>
					<PayloadSummary payload={payload} />
				</td>
				<td>
					<ManageButton label="View" onToggle={() => setOpen(value => !value)} open={open} panelId={panelId} />
				</td>
			</tr>
			<ManageRow className="hl-audit-panel" columns={6} id={panelId} open={open}>
				{payload.changes.length > 0 ? (
					<ManageSection title="Changed fields">
						<div className="hl-scroll">
							<table className="hl-audit-diff">
								<thead>
									<tr>
										<th>Field</th>
										<th>Before</th>
										<th>After</th>
									</tr>
								</thead>
								<tbody>
									{payload.changes.map(change => (
										<tr key={change.field}>
											<th scope="row">{change.field}</th>
											<td className="hl-audit-value">{formatAuditValue(change.before)}</td>
											<td className="hl-audit-value">{formatAuditValue(change.after)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</ManageSection>
				) : null}

				{payload.fields.length > 0 ? (
					<ManageSection title="Recorded detail">
						<dl className="hl-detail-list">
							{payload.fields.map(field => (
								<div key={field.key}>
									<dt>{field.key}</dt>
									<dd className="hl-audit-value">{formatAuditValue(field.value)}</dd>
								</div>
							))}
						</dl>
					</ManageSection>
				) : null}

				<ManageSection title="Entry">
					<dl className="hl-detail-list">
						<div>
							<dt>Action</dt>
							<dd className="hl-mono">{data.action}</dd>
						</div>
						<div>
							<dt>When</dt>
							<dd className="hl-mono">{data.createdAt}</dd>
						</div>
						<div>
							<dt>Actor</dt>
							<dd className="hl-mono">{actor}</dd>
						</div>
						{data.actorEmail && data.actorId ? (
							<div>
								<dt>Actor id</dt>
								<dd className="hl-mono">{data.actorId}</dd>
							</div>
						) : null}
						<div>
							<dt>IP address</dt>
							<dd className="hl-mono">{data.actorIp ?? "Not recorded"}</dd>
						</div>
						<div>
							<dt>User agent</dt>
							<dd className="hl-audit-value">{data.actorUserAgent ?? "Not recorded"}</dd>
						</div>
						<div>
							<dt>Target</dt>
							<dd>
								{data.targetType ?? "-"}
								{data.targetId ? (
									<div className="hl-mono">{href ? <Link href={href}>{data.targetId}</Link> : data.targetId}</div>
								) : null}
							</dd>
						</div>
						<div>
							<dt>Entry id</dt>
							<dd className="hl-mono">{data.id}</dd>
						</div>
					</dl>
				</ManageSection>

				<ManageSection title="Raw">
					{data.metadata === null || data.metadata === undefined ? (
						<p className="hl-hint">Nothing was recorded for this action.</p>
					) : (
						<details className="hl-audit-raw">
							<summary>Show JSON</summary>
							<pre className="hl-audit-json">{JSON.stringify(data.metadata, null, 2)}</pre>
						</details>
					)}
				</ManageSection>
			</ManageRow>
		</>
	)
}
