import { z } from "zod"
import { Role, ShopItemCategory } from "@/app/generated/prisma/enums"
import { boundedText, cuid, httpsUrl } from "@/lib/schemas/common"

export const roleChangeSchema = z.object({ role: z.enum(Role) }).strict()

export const userFlagsSchema = z
  .object({
    fraudFlagged: z.boolean().optional(),
    submissionExtensionUntil: z.coerce.date().nullable().optional(),
  })
  .strict()

export const projectExtensionSchema = z
  .object({ submissionExtensionUntil: z.coerce.date().nullable() })
  .strict()

export const creditAdjustSchema = z
  .object({
    userId: cuid,
    amount: z.number().int().refine((n) => n !== 0, "Amount cannot be zero"),
    reason: boundedText(1000, 1),
    /**
     * Which pot to move. Defaults to spendable — an admin correcting someone's
     * balance almost always means ordinary coins, and topping up the printer
     * fund should be a deliberate choice rather than the accident of an
     * omitted field.
     */
    bucket: z.enum(["SPENDABLE", "BANKED"]).default("SPENDABLE"),
  })
  .strict()

export const shopItemSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits and hyphens"),
    name: boundedText(120, 1),
    description: boundedText(2000, 1),
    imageUrl: httpsUrl.nullable().optional(),
    category: z.enum(ShopItemCategory).default("PRINTER_UPGRADE"),
    priceCredits: z.number().int().min(0),
    maxPerUser: z.number().int().min(0).default(1),
    stock: z.number().int().min(0).nullable().default(null),
    requiresPrinterQualified: z.boolean().default(true),
    active: z.boolean().default(true),
    sortOrder: z.number().int().default(0),
  })
  .strict()

export const shopItemUpdateSchema = shopItemSchema.partial().omit({ id: true }).strict()

export const orderDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("FULFILL"),
      trackingNumber: boundedText(200).optional(),
      trackingCarrier: boundedText(120).optional(),
    })
    .strict(),
  z.object({ action: z.literal("REJECT"), reason: boundedText(1000, 1) }).strict(),
  z.object({ action: z.literal("HOLD"), reason: boundedText(1000, 1) }).strict(),
])

export const programSettingsSchema = z
  .object({
    eventStartDate: z.coerce.date().optional(),
    programTimezone: boundedText(64, 1).optional(),
    submissionsOpen: z.boolean().optional(),
    submissionsCloseAt: z.coerce.date().nullable().optional(),
    shopOpen: z.boolean().optional(),
    shopClosesAt: z.coerce.date().nullable().optional(),
    shopGraceDays: z.number().int().min(0).max(90).optional(),
    reviewClaimTtlMinutes: z.number().int().min(5).max(240).optional(),
    airtableSyncEnabled: z.boolean().optional(),
  })
  .strict()

export const rsvpSchema = z
  .object({
    email: z.email().max(320),
    firstName: boundedText(120).optional(),
    lastName: boundedText(120).optional(),
    pronouns: boundedText(60).optional(),
    utmSource: boundedText(200).optional(),
    signupPage: boundedText(200).optional(),
    referredBy: boundedText(64).optional(),
  })
  .strict()
