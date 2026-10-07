import { z } from "zod"
import { ReviewResult } from "@/app/generated/prisma/enums"
import { TIER_IDS } from "@/lib/config/tiers"
import { boundedText, cuid, phaseSchema } from "@/lib/schemas/common"

const tierSchema = z
	.number()
	.int()
	.refine((n) => (TIER_IDS as readonly number[]).includes(n), {
		message: `Tier must be one of ${TIER_IDS.join(", ")}`,
	})

/**
 * A discriminated union rather than one flat object with an `if`: it makes
 * "comments are mandatory unless you are approving" a type-level fact, and it
 * makes the tier required exactly where it is meaningful.
 */
export const decisionSchema = z.discriminatedUnion("result", [
	z
		.object({
			result: z.literal(ReviewResult.APPROVED),
			feedback: boundedText(8000).default(""),
			reason: boundedText(8000).optional(),
			/** Required when approving a design; ignored on a build. */
			tier: tierSchema.optional(),
			hoursOverride: z.number().min(0).max(168).optional(),
			grantUsdOverride: z.number().int().min(0).max(500).optional(),
		})
		.strict(),
	z
		.object({
			result: z.literal(ReviewResult.RETURNED),
			feedback: boundedText(8000, 1),
			reason: boundedText(8000).optional(),
		})
		.strict(),
	z
		.object({
			result: z.literal(ReviewResult.REJECTED),
			feedback: boundedText(8000, 1),
			reason: boundedText(8000, 1),
		})
		.strict(),
])

export const hoursDecisionSchema = z
	.object({
		decisions: z
			.array(
				z.discriminatedUnion("kind", [
					z
						.object({
							kind: z.literal("session"),
							id: cuid,
							hoursApproved: z.number().min(0).max(24),
							comments: boundedText(2000).optional(),
						})
						.strict(),
					z
						.object({
							kind: z.literal("hackatime"),
							id: cuid,
							hoursApproved: z.number().min(0).max(2000),
						})
						.strict(),
				]),
			)
			.min(1)
			// Reviewers approve a whole project's hours in one pass, so this is
			// batched; the bound stops a pathological payload.
			.max(100),
	})
	.strict()

export const reviewQueueQuery = z.object({
	phase: phaseSchema.optional(),
	theme: z.string().optional(),
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(25),
})

export const overrideSchema = z.object({ phase: phaseSchema, reason: boundedText(2000, 1) }).strict()
