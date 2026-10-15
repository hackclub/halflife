import Link from "next/link"
import { EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { listAuditLog } from "@/lib/queries/admin"

export const dynamic = "force-dynamic"

type Props = { searchParams: Promise<{ action?: string; targetId?: string; cursor?: string }> }

export default async function AdminAuditPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.VIEW_AUDIT_LOG)
	const { action, targetId, cursor } = await searchParams

	const { items, nextCursor } = await listAuditLog({ action, targetId, cursor, limit: 50 })

	return (
		<div className="hl-stack">
			<PageHeader subtitle="Every mutation, with what it changed from and to." title="Audit log" />

			<Panel>
				<form className="hl-row" method="get">
					<input
						className="hl-input"
						defaultValue={action ?? ""}
						name="action"
						placeholder="Action, e.g. REVIEW_APPROVE"
						style={{ maxWidth: "20rem" }}
					/>
					<input
						className="hl-input"
						defaultValue={targetId ?? ""}
						name="targetId"
						placeholder="Target id"
						style={{ maxWidth: "20rem" }}
					/>
					<button className="hl-btn" type="submit">
						Filter
					</button>
				</form>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>Nothing recorded yet.</EmptyState>
				) : (
					<Table head={["When", "Action", "Actor", "Target", "Detail"]}>
						{items.map(entry => (
							<tr key={entry.id}>
								<td className="hl-mono">{entry.createdAt.toLocaleString()}</td>
								<td className="hl-mono">{entry.action}</td>
								<td className="hl-hint">{entry.actorEmail ?? entry.actorId ?? "system"}</td>
								<td className="hl-mono">
									{entry.targetType}
									{entry.targetId ? <div className="hl-hint">{entry.targetId}</div> : null}
								</td>
								<td className="hl-hint" style={{ maxWidth: "28rem", wordBreak: "break-word" }}>
									{entry.metadata ? JSON.stringify(entry.metadata) : ""}
								</td>
							</tr>
						))}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link
							href={`/admin/audit?${action ? `action=${action}&` : ""}${targetId ? `targetId=${targetId}&` : ""}cursor=${nextCursor}`}
						>
							Next page
						</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
