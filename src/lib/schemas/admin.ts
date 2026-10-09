import { z } from "zod"
import {
	EventColour,
	Phase,
	PrinterAwardStatus,
	Role,
	ShopFulfillmentMethod,
	ShopFulfillmentStage,
	ShopItemCategory,
	Theme,
} from "@/app/generated/prisma/enums"
import { boundedText, cuid, httpsUrl } from "@/lib/schemas/common"

export const roleChangeSchema = z.object({ role: z.enum(Role) }).strict()

export const userFlagsSchema = z
	.object({
		fraudFlagged: z.boolean().optional(),
		submissionExtensionUntil: z.coerce.date().nullable().optional(),
	})
	.strict()

export const projectExtensionSchema = z
	.object({
		submissionExtensionUntil: z.coerce.date().nullable().optional(),
		theme: z.enum(Theme).optional(),
	})
	.strict()
	.refine((b) => b.submissionExtensionUntil !== undefined || b.theme !== undefined, "Nothing to change")

/** Closing a maker's dispute. The note is optional; it is for the record. */
export const resolveDisputeSchema = z.object({ note: boundedText(2000).optional() }).strict()

/** Sending a design's parts grant to a maker's HCB card grant. */
export const grantSchema = z
	.object({
		// The design phase is the funding decision; a build grant does not exist, and accepting BUILD here sent the design's grant a second time.
		phase: z.literal(Phase.DESIGN),
		grantUrl: boundedText(500, 4),
	})
	.strict()

export const creditAdjustSchema = z
	.object({
		userId: cuid,
		amount: z
			.number()
			.int()
			.min(-10_000, "Amount must be within ±10,000 per adjustment")
			.max(10_000, "Amount must be within ±10,000 per adjustment")
			.refine((n) => n !== 0, "Amount cannot be zero"),
		reason: boundedText(1000, 1),
		/**
		 * Which pot to move. Defaults to spendable – an admin correcting someone's balance almost always means ordinary coins, and topping up the printer fund should be a deliberate choice rather than the accident of an omitted field.
		 */
		bucket: z.enum(["SPENDABLE", "BANKED"]).default("SPENDABLE"),
	})
	.strict()

/** Moving a printer award along its fulfilment path (or revoking it). */
export const printerAwardUpdateSchema = z
	.object({
		status: z.enum(PrinterAwardStatus),
		trackingNumber: boundedText(200).optional(),
		trackingCarrier: boundedText(120).optional(),
		/** Recorded on the audit row; the server requires one to revoke. */
		note: boundedText(2000).optional().default(""),
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
		/** Dollars, rounded to the cent on write. */
		costUsd: z.number().min(0).max(100_000).nullable().optional(),
		maxPerUser: z.number().int().min(0).default(1),
		stock: z.number().int().min(0).nullable().default(null),
		requiresPrinterQualified: z.boolean().default(true),
		active: z.boolean().default(true),
		sortOrder: z.number().int().default(0),
	})
	.strict()

export const shopItemUpdateSchema = shopItemSchema.partial().omit({ id: true }).strict()

/**
 * A sales region: a hand-assigned slug (it appears in analytics and has to survive a rename) and a display name.
 */
export const shopRegionSchema = z
	.object({
		id: z
			.string()
			.trim()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits and hyphens"),
		name: boundedText(80, 1),
		sortOrder: z.number().int().default(0),
	})
	.strict()

export const shopRegionUpdateSchema = z
	.object({
		name: boundedText(80, 1).optional(),
		sortOrder: z.number().int().optional(),
		active: z.boolean().optional(),
	})
	.strict()
	.refine((b) => b.name !== undefined || b.sortOrder !== undefined || b.active !== undefined, "Nothing to change")

/**
 * One region's coin price for one shop item. Null clears the override back to base pricing.
 */
export const itemRegionPriceSchema = z
	.object({
		regionId: boundedText(64, 1),
		priceCredits: z.number().int().min(0).nullable(),
	})
	.strict()

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

/** Either or both; `method: null` clears a choice made by mistake. */
export const orderFulfillmentSchema = z
	.object({
		method: z.enum(ShopFulfillmentMethod).nullable().optional(),
		stage: z.enum(ShopFulfillmentStage).optional(),
	})
	.strict()
	.refine((b) => b.method !== undefined || b.stage !== undefined, "Nothing to change")

/**
 * Creating an event on the programme calendar.
 *
 * `startsAt` and `endsAt` arrive as ISO strings from `datetime-local` inputs, so
 * they are coerced rather than typed as dates on the wire. The end is optional
 * and independent: an open call has no end, and a call with a start but a blank
 * end is a common mistake rather than a nonsense one.
 *
 * `repeatWeeks` asks the route to write the whole series in one go rather than
 * making an admin press create ten times. It is a number of *weeks*, so the
 * occurrences land on the same weekday; the route owns the arithmetic and the
 * audit row records how many were made.
 */
export const programEventCreateSchema = z
	.object({
		title: boundedText(120, 1),
		colour: z.enum(EventColour).default(EventColour.SLATE),
		description: boundedText(2000).nullable().optional(),
		startsAt: z.coerce.date(),
		endsAt: z.coerce.date().nullable().optional(),
		published: z.boolean().default(true),
		/** 1 is a one-off. Capped at a year of weeks so a stray keypress cannot ask for ten thousand rows. */
		repeatWeeks: z.number().int().min(1).max(52).default(1),
	})
	.strict()
	.refine((b) => b.endsAt === null || b.endsAt === undefined || b.endsAt > b.startsAt, {
		message: "An event has to end after it starts",
		path: ["endsAt"],
	})

/**
 * Editing one occurrence.
 *
 * No `repeatWeeks`: a series is edited one occurrence at a time on purpose, since
 * that is the edit that actually gets made. `null` is the clear for a nullable
 * field, so a half-finished draft can be emptied rather than only set.
 */
export const programEventUpdateSchema = z
	.object({
		title: boundedText(120, 1).optional(),
		colour: z.enum(EventColour).optional(),
		description: boundedText(2000).nullable().optional(),
		startsAt: z.coerce.date().optional(),
		endsAt: z.coerce.date().nullable().optional(),
		published: z.boolean().optional(),
	})
	.strict()
	.refine((b) => Object.keys(b).length > 0, "Nothing to change")

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
		repoSyncEnabled: z.boolean().optional(),
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

/** Unauthenticated landing-page signup. Freeform referral/UTM input is capped, never validated for shape. */
export const subscribeSchema = z
	.object({
		email: z.email().max(320),
		ref: boundedText(128).optional(),
		utmSource: boundedText(128).optional(),
		utmMedium: boundedText(128).optional(),
		utmCampaign: boundedText(128).optional(),
	})
	.strict()
