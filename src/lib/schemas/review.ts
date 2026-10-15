import { z } from "zod"
import { ReviewResult } from "@/app/generated/prisma/enums"
import { TIER_IDS } from "@/lib/config/tiers"
import { paginationQuery } from "@/lib/pagination"
import { boundedText, cuid, phaseSchema } from "@/lib/schemas/common"
import { MAX_SESSION_HOURS } from "@/lib/schemas/session"

const tierSchema = z
	.number()
	.int()
	.refine(n => (TIER_IDS as readonly number[]).includes(n), {
		message: `Tier must be one of ${TIER_IDS.join(", ")}`,
	})

/**
 * A discriminated union rather than one flat object with an `if`: it makes "comments are mandatory unless you are approving" a type-level fact, and it makes the tier required exactly where it is meaningful.
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
							hoursApproved: z.number().min(0).max(MAX_SESSION_HOURS),
							comments: boundedText(2000).optional(),
						})
						.strict(),
					z
						.object({
							kind: z.literal("hackatime"),
							id: cuid,
							// Matches the decision override ceiling, so per-source approvals cannot exceed what a decision-level override allows.
							hoursApproved: z.number().min(0).max(168),
						})
						.strict(),
				]),
			)
			.min(1)
			// Reviewers approve a whole project's hours in one pass, so this is batched; the bound stops a pathological payload.
			.max(100),
	})
	.strict()

// Extends rather than restates: this route used to spell its own cursor and limit, and its cursor lacked the `.min(1)` every other paged route has – an empty-string cursor parsed here and nowhere else.
export const reviewQueueQuery = paginationQuery.extend({
	phase: phaseSchema.optional(),
	theme: z.string().optional(),
})

export const overrideSchema = z.object({ phase: phaseSchema, reason: boundedText(2000, 1) }).strict()
