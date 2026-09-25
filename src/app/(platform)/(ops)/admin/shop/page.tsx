import prisma from "@/lib/prisma"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { Badge, EmptyState, PageHeader, Panel, Table } from "@/app/components/ui"
import { ShopItemForm } from "@/app/components/forms/ShopItemForm"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { ItemCostField } from "@/app/components/forms/ItemCostField"

export const dynamic = "force-dynamic"

export default async function AdminShopPage() {
  await requirePermissionPage(Permission.MANAGE_SHOP)
  const items = await prisma.shopItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  })

  return (
    <div className="hl-stack">
      <PageHeader title="Shop items" />

      <Panel title="Catalogue">
        {items.length === 0 ? (
          <EmptyState>No items yet.</EmptyState>
        ) : (
          <Table head={["Slug", "Name", "Price", "Cost (USD)", "Stock", "Gated", "Active", ""]}>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="hl-mono">{item.id}</td>
                <td>{item.name}</td>
                <td>{item.priceCredits}</td>
                <td>
                  <ItemCostField itemId={item.id} costUsd={item.costUsd} />
                </td>
                <td>{item.stock ?? "∞"}</td>
                <td>{item.requiresPrinterQualified ? "all 5 themes" : "no"}</td>
                <td>
                  <Badge tone={item.active ? "success" : "muted"}>
                    {item.active ? "active" : "retired"}
                  </Badge>
                </td>
                <td>
                  {item.active ? (
                    <ActionButton
                      url={`/api/admin/shop/items/${item.id}`}
                      method="DELETE"
                      label="Retire"
                      confirm="Retire this item? Existing orders keep working."
                    />
                  ) : (
                    <ActionButton
                      url={`/api/admin/shop/items/${item.id}`}
                      method="PATCH"
                      body={{ active: true }}
                      label="Re-list"
                    />
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Add an item">
        <ShopItemForm />
      </Panel>
    </div>
  )
}
