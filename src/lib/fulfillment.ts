import type { ShopFulfillmentMethod, ShopFulfillmentStage } from "@/lib/enums"

export const METHOD_LABELS: { [_ in ShopFulfillmentMethod]: string } = {
	BULK_TO_HQ: "Bulk ordering to HQ",
	DIRECT_SHIP: "Directly shipping",
}

export const STAGE_LABELS: { [_ in ShopFulfillmentStage]: string } = {
	CANCELLED: "Cancelled",
	ORDERED_TO_HQ: "Ordered to HQ",
	SENT_FOR_DELIVERY: "Sent for delivery",
	UNFULFILLED: "Unfulfilled",
}
