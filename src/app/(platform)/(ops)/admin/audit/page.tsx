import Link from "next/link"
import { Button, EmptyState, PageHeader, Panel, Table, TextInput } from "@/app/components/ui"
import { IconFilter } from "@/app/components/ui/icons"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { listAuditLog } from "@/lib/queries/admin"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { parseDbTimestamp } from "@/lib/time"
import { AuditRow } from "./AuditRow"

export const dynamic = "force-dynamic"

interface Props {
	searchParams: Promise<{ action?: SearchParamValue; cursor?: SearchParamValue; targetId?: SearchParamValue }>
}

export default async function AdminAuditPage({ searchParams }: Props) {
	await requirePermissionPage(Permission.VIEW_AUDIT_LOG)
	// Each filter is taken as the single value the URL named: a repeated parameter arrives as an array, and an array where a string was expected is not a value this page can read.
	const { action, targetId, cursor } = firstValues(await searchParams)

	const { items, nextCursor } = await listAuditLog({ action, cursor, limit: 50, targetId })

	// The next page keeps every filter; only the cursor moves.
	const nextParams = new URLSearchParams(
		Object.entries({ action, cursor: nextCursor ?? undefined, targetId }).filter(
			(e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
		),
	)

	return (
		<div className="hl-stack hl-page-wide">
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
					<Button type="submit">
						<IconFilter /> Filter
					</Button>
				</form>
			</Panel>

			<Panel>
				{items.length === 0 ? (
					<EmptyState>Nothing recorded yet.</EmptyState>
				) : (
					<Table className="hl-table--roomy" head={["When", "Action", "Actor", "Target", "Detail", "Actions"]}>
						{items.map(entry => (
							<AuditRow
								data={{
									action: entry.action,
									actorEmail: entry.actorEmail,
									actorId: entry.actorId,
									actorIp: entry.actorIp,
									actorUserAgent: entry.actorUserAgent,
									createdAt: parseDbTimestamp(entry.createdAt).toLocaleString(),
									id: entry.id,
									metadata: entry.metadata,
									targetId: entry.targetId,
									targetType: entry.targetType,
								}}
								key={entry.id}
							/>
						))}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link href={`/admin/audit?${nextParams.toString()}`}>Next page</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
