import "server-only"
import { ShopDeliveryPreference, ShopFulfillmentMethod, ShopFulfillmentStage } from "@/lib/enums"
import {
	FULFILLMENT_ORDER_STATUSES,
	type FulfillmentFilters,
	type FulfillmentOrderRow,
} from "@/lib/queries/fulfillment"
import { DAY_MS } from "@/lib/time"

/** How many orders one page of the fulfilment sheet holds. */
export const FULFILLMENT_PAGE_SIZE = 50

/** The filter parameters the sheet reads, each as the single string the URL named. */
export interface FulfillmentSearch {
	delivery?: string
	from?: string
	method?: string
	/** One order by its ID, so a link from elsewhere can show just that order. */
	order?: string
	stage?: string
	status?: string
	to?: string
}

/** A `YYYY-MM-DD` from a date input, as midnight UTC. Anything else is dropped. */
function utcDay(v?: string): Date | undefined {
	if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
	const d = new Date(`${v}T00:00:00Z`)
	return Number.isNaN(d.getTime()) ? undefined : d
}

/** Anything unrecognised in the query string is dropped, not trusted. */
export function fulfillmentFiltersFrom(s: FulfillmentSearch): FulfillmentFilters {
	const to = utcDay(s.to)
	return {
		delivery: s.delivery === "NONE" ? "NONE" : Object.values(ShopDeliveryPreference).find(d => d === s.delivery),
		method: s.method === "NONE" ? "NONE" : Object.values(ShopFulfillmentMethod).find(m => m === s.method),
		orderId: s.order && s.order.length <= 64 ? s.order : undefined,
		// The "to" day is inclusive, so the bound is the midnight after it.
		placedBefore: to ? new Date(to.getTime() + DAY_MS) : undefined,
		placedFrom: utcDay(s.from),
		stage: Object.values(ShopFulfillmentStage).find(x => x === s.stage),
		status: FULFILLMENT_ORDER_STATUSES.find(x => x === s.status),
	}
}

/** An order as the sheet's browser side draws it: the instants as ISO text, since they cross to the browser as JSON. */
export interface FulfillmentOrderJson extends Omit<FulfillmentOrderRow, "cancelledAt" | "fulfilledAt" | "placedAt"> {
	cancelledAt: string | null
	fulfilledAt: string | null
	placedAt: string
}

export function toFulfillmentJson(order: FulfillmentOrderRow): FulfillmentOrderJson {
	return {
		...order,
		cancelledAt: order.cancelledAt?.toISOString() ?? null,
		fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
		placedAt: order.placedAt.toISOString(),
	}
}
