import { z } from "zod"
import { HoursSource, MediaType } from "@/app/generated/prisma/enums"
import { boundedText, phaseSchema } from "@/lib/schemas/common"

const mediaSchema = z.object({
	type: z.enum(MediaType),
	objectKey: z.string().min(1).max(500),
	contentType: z.string().max(120).optional(),
	byteSize: z.number().int().positive().optional(),
})

/**
 * A timelapse is a Lapse timelapse, named by its id. Everything else about it – owner, runtime, playback URL – is read back from Lapse by the route rather than taken from the request, because those are the facts a reviewer relies on and the client is the one party with a reason to overstate them.
 */
const timelapseSchema = z
	.object({
		lapseId: z.string().min(1).max(100),
	})
	.strict()

export const sessionCreateSchema = z
	.object({
		phase: phaseSchema,
		title: boundedText(200, 1),
		content: boundedText(20_000).optional(),
		// A single sitting cannot exceed a day. This is a sanity bound, not a policy.
		hoursClaimed: z.number().min(0).max(24),
		/**
		 * MANUAL counts toward the journal total; HACKATIME_TRACKED does not, because those hours already arrive through the linked project.
		 */
		hoursSource: z.enum(HoursSource).default("MANUAL"),
		media: z.array(mediaSchema).max(10).default([]),
		timelapses: z.array(timelapseSchema).max(5).default([]),
	})
	.strict()

export const sessionUpdateSchema = sessionCreateSchema.partial().strict()

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>
