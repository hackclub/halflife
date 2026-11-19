import type { ShopDeliveryPreference, ShopFulfillmentMethod, ShopFulfillmentStage } from "@/lib/enums"

/** The buyer's choice, in the words staff act on. */
export const DELIVERY_LABELS: { [_ in ShopDeliveryPreference]: string } = {
	GRANT_CARD: "Grant card requested",
	SHIP: "Ship to address",
}

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
