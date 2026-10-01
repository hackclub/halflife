import Link from "next/link"
import { EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { requireAnyPermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getAdminCounters } from "@/lib/queries/admin"
import { getLatestSyncRuns } from "@/lib/sync-run-log"

export const dynamic = "force-dynamic"

export default async function AdminOverviewPage() {
  await requireAnyPermissionPage(
    Permission.VIEW_USERS,
    Permission.MANAGE_SHOP,
    Permission.FULFILL_ORDERS,
    Permission.VIEW_AUDIT_LOG,
    Permission.MANAGE_PROGRAM,
  )

  const [counters, syncs] = await Promise.all([
    getAdminCounters(),
    getLatestSyncRuns([
      "hackatime",
      "airtable_ysws",
      "airtable_rsvp",
      "airtable_loops",
      "ari_ship",
      "claim_sweep",
      "printer_reconcile",
    ]),
  ])

  return (
    <div className="hl-stack">
      <PageHeader title="Overview" />

      <div className="hl-row">
        <Stat label="Awaiting review" value={counters.pendingReviews} />
        <Stat label="Orders to fulfil" value={counters.pendingOrders} />
        <Stat label="Participants" value={counters.participants} />
        <Stat label="Printers earned" value={counters.shipped} />
      </div>

      <Panel
        title="Scheduled jobs"
        actions={<Link href="/admin/audit?action=AIRTABLE_SYNC_FAILURE">Sync failures</Link>}
      >
        {syncs.length === 0 ? (
          <EmptyState>No job has completed yet. Run them by hand from Orchard to check the wiring.</EmptyState>
        ) : (
          <Table head={["Job", "Last success", "Result"]}>
            {syncs.map((run) => (
              <tr key={run.syncKey}>
                <td className="hl-mono">{run.syncKey}</td>
                <td className="hl-mono">{run.lastRunAt.toLocaleString()}</td>
                <td className="hl-hint">{JSON.stringify(run.result)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </div>
  )
}
