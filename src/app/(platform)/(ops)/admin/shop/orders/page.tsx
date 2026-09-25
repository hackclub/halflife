import Link from "next/link"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { listOrders } from "@/lib/queries/admin"
import { ShopOrderStatus } from "@/app/generated/prisma/enums"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { OrderDecision } from "@/app/components/forms/OrderDecision"

export const dynamic = "force-dynamic"

type Props = { searchParams: Promise<{ status?: string; cursor?: string }> }

export default async function AdminOrdersPage({ searchParams }: Props) {
  await requirePermissionPage(Permission.FULFILL_ORDERS)
  const { status, cursor } = await searchParams

  const parsedStatus = status && status in ShopOrderStatus ? (status as ShopOrderStatus) : undefined
  const { items, nextCursor } = await listOrders({ status: parsedStatus, cursor, limit: 50 })

  return (
    <div className="hl-stack">
      <PageHeader title="Orders" />

      <div className="hl-row">
        <Link href="/admin/shop/orders" className="hl-btn">
          All
        </Link>
        <Link href="/admin/shop/orders?status=PENDING" className="hl-btn">
          Pending
        </Link>
        <Link href="/admin/shop/orders?status=ON_HOLD" className="hl-btn">
          On hold
        </Link>
      </div>

      <Panel>
        {items.length === 0 ? (
          <EmptyState>No orders.</EmptyState>
        ) : (
          <Table head={["#", "Participant", "Item", "Cost", "Status", "Action"]}>
            {items.map((order) => (
              <tr key={order.id}>
                <td className="hl-mono">{order.orderNumber}</td>
                <td>
                  <Link href={`/admin/users/${order.user.id}`}>{order.user.name ?? order.user.email}</Link>
                </td>
                <td>{order.itemNameSnapshot}</td>
                <td>{order.totalCredits}</td>
                <td>
                  <Badge
                    tone={order.status === "FULFILLED" ? "success" : order.status === "REJECTED" ? "danger" : "warning"}
                  >
                    {order.status.toLowerCase()}
                  </Badge>
                </td>
                <td>
                  {order.status === "PENDING" || order.status === "ON_HOLD" ? (
                    <OrderDecision orderId={order.id} />
                  ) : (
                    <span className="hl-hint">decided</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {nextCursor ? (
          <p>
            <Link href={`/admin/shop/orders?${status ? `status=${status}&` : ""}cursor=${nextCursor}`}>Next page</Link>
          </p>
        ) : null}
      </Panel>
    </div>
  )
}
