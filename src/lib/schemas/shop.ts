import { z } from "zod"
import { boundedText } from "@/lib/schemas/common"

export const purchaseSchema = z
	.object({
		/**
		 * One per purchase intent, reused across retries so a retried request resolves to the order it already made instead of charging twice.
		 */
		idempotencyKey: z.string().trim().min(8).max(64),
		note: boundedText(1000).optional(),
		quantity: z.number().int().min(1).max(5).default(1),
		shopItemId: z.string().min(1).max(64),
	})
	.strict()

/**
 * A participant picking which region's prices their shop shows. Null is base pricing. The region has to exist and be active – checked in the route, so a deactivated region falls back to base rather than stranding anyone.
 */
export const shopRegionPreferenceSchema = z
	.object({
		regionId: boundedText(64, 1).nullable(),
	})
	.strict()
