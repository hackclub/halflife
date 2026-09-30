import { z } from "zod"
import { boundedText, cuid } from "@/lib/schemas/common"

export const purchaseSchema = z
  .object({
    shopItemId: z.string().min(1).max(64),
    quantity: z.number().int().min(1).max(5).default(1),
    /**
     * One per purchase intent, so a retried request resolves to the order it
     * already made instead of charging twice.
     */
    idempotencyKey: z.string().trim().min(8).max(64).optional(),
    note: boundedText(1000).optional(),
  })
  .strict()

export const orderNoteSchema = z.object({ orderId: cuid, body: boundedText(2000, 1) }).strict()
