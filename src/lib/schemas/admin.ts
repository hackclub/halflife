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
		/**
		 * Trimmed, but NOT lowercased: the local part of an address is case-sensitive per RFC 5321, and folding it is a silent edit to someone's data that nobody asked for.
		 *
		 * `pipe` rather than a trailing `.transform()` because the trim has to run BEFORE the format check - `z.email()` on the raw value rejects a pasted address with surrounding whitespace outright, so an ordinary copy-and-paste would fail rather than be tidied.
		 *
		 * Case is normalised in exactly one place: the uniqueness check in the route compares insensitively, so two spellings of one address still cannot both become rows.
		 */
		email: z.string().trim().pipe(z.email().max(320)).optional(),
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
	.refine(b => b.submissionExtensionUntil !== undefined || b.theme !== undefined, "Nothing to change")

/** A reply in a dispute thread. Required and non-empty: a blank reply answers nothing. */
export const disputeMessageSchema = z.object({ body: boundedText(2000, 1) }).strict()

/** Sending a design's parts grant to a maker's HCB card grant. */
export const grantSchema = z
	.object({
		grantUrl: boundedText(500, 4),
		// The design phase is the funding decision; a build grant does not exist, and accepting BUILD here sent the design's grant a second time.
		phase: z.literal(Phase.DESIGN),
	})
	.strict()

export const creditAdjustSchema = z
	.object({
		amount: z
			.number()
			.int()
			.min(-10_000, "Amount must be within ±10,000 per adjustment")
			.max(10_000, "Amount must be within ±10,000 per adjustment")
			.refine(n => n !== 0, "Amount cannot be zero"),
		/**
		 * Which pot to move. Defaults to spendable – an admin correcting someone's balance almost always means ordinary coins, and topping up the printer fund should be a deliberate choice rather than the accident of an omitted field.
		 */
		bucket: z.enum(["SPENDABLE", "BANKED"]).default("SPENDABLE"),
		reason: boundedText(1000, 1),
		userId: cuid,
	})
	.strict()

/** Moving a printer award along its fulfilment path (or revoking it). */
export const printerAwardUpdateSchema = z
	.object({
		/** Recorded on the audit row; the server requires one to revoke. */
		note: boundedText(2000).optional().default(""),
		status: z.enum(PrinterAwardStatus),
		trackingCarrier: boundedText(120).optional(),
		trackingNumber: boundedText(200).optional(),
	})
	.strict()

export const shopItemSchema = z
	.object({
		active: z.boolean().default(true),
		category: z.enum(ShopItemCategory).default("PRINTER_UPGRADE"),
		/** Dollars, rounded to the cent on write. */
		costUsd: z.number().min(0).max(100_000).nullable().optional(),
		description: boundedText(2000, 1),
		id: z
			.string()
			.trim()
			.min(1)
			.max(64)
			.regex(/^[a-z0-9][a-z0-9-]*$/, "Lowercase letters, digits and hyphens"),
		imageUrl: httpsUrl.nullable().optional(),
		maxPerUser: z.number().int().min(0).default(1),
		name: boundedText(120, 1),
		priceCredits: z.number().int().min(0).max(1_000_000),
		requiresPrinterQualified: z.boolean().default(true),
		sortOrder: z.number().int().default(0),
		stock: z.number().int().min(0).nullable().default(null),
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
		active: z.boolean().optional(),
		name: boundedText(80, 1).optional(),
		sortOrder: z.number().int().optional(),
	})
	.strict()
	.refine(b => b.name !== undefined || b.sortOrder !== undefined || b.active !== undefined, "Nothing to change")

/**
 * One region's coin price for one shop item. Null clears the override back to base pricing.
 */
export const itemRegionPriceSchema = z
	.object({
		priceCredits: z.number().int().min(0).max(1_000_000).nullable(),
		regionId: boundedText(64, 1),
	})
	.strict()

export const orderDecisionSchema = z.discriminatedUnion("action", [
	z
		.object({
			action: z.literal("FULFILL"),
			trackingCarrier: boundedText(120).optional(),
			trackingNumber: boundedText(200).optional(),
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
	.refine(b => b.method !== undefined || b.stage !== undefined, "Nothing to change")

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
		colour: z.enum(EventColour).default(EventColour.SLATE),
		description: boundedText(2000).nullable().optional(),
		endsAt: z.coerce.date().nullable().optional(),
		published: z.boolean().default(true),
		/** 1 is a one-off. Capped at a year of weeks so a stray keypress cannot ask for ten thousand rows. */
		repeatWeeks: z.number().int().min(1).max(52).default(1),
		startsAt: z.coerce.date(),
		title: boundedText(120, 1),
	})
	.strict()
	.refine(b => b.endsAt === null || b.endsAt === undefined || b.endsAt > b.startsAt, {
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
		colour: z.enum(EventColour).optional(),
		description: boundedText(2000).nullable().optional(),
		endsAt: z.coerce.date().nullable().optional(),
		published: z.boolean().optional(),
		startsAt: z.coerce.date().optional(),
		title: boundedText(120, 1).optional(),
	})
	.strict()
	.refine(b => Object.keys(b).length > 0, "Nothing to change")

export const programSettingsSchema = z
	.object({
		airtableSyncEnabled: z.boolean().optional(),
		eventStartDate: z.coerce.date().optional(),
		programTimezone: boundedText(64, 1).optional(),
		repoSyncEnabled: z.boolean().optional(),
		reviewClaimTtlMinutes: z.number().int().min(5).max(240).optional(),
		shopClosesAt: z.coerce.date().nullable().optional(),
		shopGraceDays: z.number().int().min(0).max(90).optional(),
		shopOpen: z.boolean().optional(),
		submissionsCloseAt: z.coerce.date().nullable().optional(),
		submissionsOpen: z.boolean().optional(),
	})
	.strict()

export const rsvpSchema = z
	.object({
		email: z.email().max(320),
		firstName: boundedText(120).optional(),
		lastName: boundedText(120).optional(),
		pronouns: boundedText(60).optional(),
		referredBy: boundedText(64).optional(),
		signupPage: boundedText(200).optional(),
		utmSource: boundedText(200).optional(),
	})
	.strict()

/** Unauthenticated landing-page signup. Freeform referral/UTM input is capped, never validated for shape. */
export const subscribeSchema = z
	.object({
		email: z.email().max(320),
		ref: boundedText(128).optional(),
		utmCampaign: boundedText(128).optional(),
		utmMedium: boundedText(128).optional(),
		utmSource: boundedText(128).optional(),
	})
	.strict()
