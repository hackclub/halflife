import Link from "next/link"
import { EmptyState, PageHeader, Panel, Table, TextInput } from "@/app/components/ui"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { listAuditLog } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { parseDbTimestamp } from "@/lib/time"

export const dynamic = "force-dynamic"

interface Props {
	searchParams: Promise<{ action?: SearchParamValue; cursor?: SearchParamValue; targetId?: SearchParamValue }>
}

export default async function AdminAuditPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.VIEW_AUDIT_LOG)
	// Each filter is taken as the single value the URL named: a repeated parameter arrives as an array, and an array where a string was expected is not a value this page can read.
	const { action, targetId, cursor } = firstValues(await searchParams)

	const { items, nextCursor } = await listAuditLog({ action, cursor, limit: 50, targetId })

	return (
		<div className="hl-stack">
			<PageHeader subtitle="Every mutation, with what it changed from and to." title="Audit log" />

			<Panel>
				<form className="hl-row" method="get">
					<TextInput
						defaultValue={action ?? ""}
						name="action"
						placeholder="Action, e.g. REVIEW_APPROVE"
						style={{ maxWidth: "20rem" }}
					/>
					<TextInput
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
								<td className="hl-mono">{parseDbTimestamp(entry.createdAt).toLocaleString()}</td>
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
