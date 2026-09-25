import type { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/app/generated/prisma/enums"

export const METHOD_LABELS: Record<ShopFulfillmentMethod, string> = {
  DIRECT_SHIP: "Directly shipping",
  BULK_TO_HQ: "Bulk ordering to HQ",
}

export const STAGE_LABELS: Record<ShopFulfillmentStage, string> = {
  UNFULFILLED: "Unfulfilled",
  ORDERED_TO_HQ: "Ordered to HQ",
  SENT_FOR_DELIVERY: "Sent for delivery",
  CANCELLED: "Cancelled",
}
