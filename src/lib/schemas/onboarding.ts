import { z } from "zod"
import { HardwareExperience } from "@/app/generated/prisma/enums"
import { boundedText } from "@/lib/schemas/common"
import { REPO_URL_RE } from "@/lib/schemas/project"

/**
 * One variant per step, discriminated on `step`.
 *
 * A single flat schema with every field optional would let a client post a tier alongside a project description and have both applied, which is how a starter project's Tier 1 lock gets written and then overwritten in the same request. Keeping the shapes separate means each step can only say the thing that step is for.
 */
export const onboardingStepSchema = z.discriminatedUnion("step", [
	z
		.object({
			experience: z.enum(HardwareExperience),
			step: z.literal("experience"),
		})
		.strict(),

	z
		.object({
			/**
			 * The beginner's fork on the week step. A starter id means "build this one" and skips straight to time tracking; null means "my own project" and goes on to naming it. Left out by anyone not offered a starter,
			 * for whom the step is only an explainer.
			 */
			starterProjectId: z.string().trim().min(1).max(64).nullable().optional(),
			step: z.literal("week"),
		})
		.strict(),

	z
		.object({
			// Matches the session journal's ceiling; the field is sanitized as HTML on the way in, same as a journal entry.
			description: boundedText(5000),
			step: z.literal("project"),
			title: boundedText(120, 1),
		})
		.strict(),

	z
		.object({
			/** Null means "none of these, I'll write my own". */
			starterProjectId: z.string().trim().min(1).max(64).nullable(),
			step: z.literal("idea"),
		})
		.strict(),

	z
		.object({
			/**
			 * Null means "move on without choosing", which is only legal when the choice is already locked to Tier 1 by a starter project. The state machine enforces that – a null here from someone who can choose is rejected rather than silently skipping the question.
			 */
			requestedTier: z.number().int().min(1).max(3).nullable(),
			step: z.literal("tier"),
		})
		.strict(),

	z
		.object({
			dismissed: z.boolean(),
			step: z.literal("tracking"),
		})
		.strict(),

	z
		.object({
			/**
			 * Whether the maker wants their devlogs and parts list mirrored into a repo. `repo` is the full URL of a repo the picker offered. Null/omitted means "not yet", which is the same as skipping: the step is optional, and the project page carries the same control forever.
			 */
			enabled: z.boolean(),
			repo: z.string().trim().regex(REPO_URL_RE, "Pick a repository to sync to").max(300).nullable().optional(),
			step: z.literal("repo"),
		})
		.strict(),
])

export type OnboardingStepInput = z.infer<typeof onboardingStepSchema>
