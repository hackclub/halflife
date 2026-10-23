import type { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/app/generated/prisma/enums"

const METHOD_LABELS: Record<ShopFulfillmentMethod, string> = {
	BULK_TO_HQ: "Bulk ordering to HQ",
	DIRECT_SHIP: "Directly shipping",
}

const STAGE_LABELS: Record<ShopFulfillmentStage, string> = {
	CANCELLED: "Cancelled",
	ORDERED_TO_HQ: "Ordered to HQ",
	SENT_FOR_DELIVERY: "Sent for delivery",
	UNFULFILLED: "Unfulfilled",
}

export { METHOD_LABELS, STAGE_LABELS }
