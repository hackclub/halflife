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
 * How long a clip reference may be.
 *
 * A ref is one of two things, and the longer one is the reason this is not a small number. A Lapse timelapse id is short. A legacy clip is an R2 object key, and a journal picture is named after its bytes, so `sessions/<cuid>/<64 hex chars>.<ext>` runs to 104 – over the 100 this used to allow. Editing an entry holding one of those sent the key straight back, was refused by the cap, and surfaced as "Invalid request" with nothing to act on. The longest key an upload can mint is `mediaSchema`'s object key, so both bounds are the same 500.
 */
export const MAX_CLIP_REF_LENGTH = 500

/**
 * A timelapse is a Lapse timelapse, named by its id, or a legacy R2 clip named by its key – editing an entry sends back whatever it was saved with, and the route tells the two apart. Everything else about it – owner, runtime, playback URL – is read back from Lapse by the route rather than taken from the request, because those are the facts a reviewer relies on and the client is the one party with a reason to overstate them.
 */
const timelapseSchema = z
	.object({
		lapseId: z.string().min(1).max(MAX_CLIP_REF_LENGTH),
	})
	.strict()

/**
 * One devlog covers a single sitting. The sheet refuses above it rather than failing opaquely on save, and the reviewer cannot approve above it either.
 */
export const MAX_SESSION_HOURS = 15

/**
 * How much an entry may hold, in characters.
 *
 * Exported because the sheet needs the same number: it puts `maxLength` on the entry box, so the ceiling is reached by running out of room rather than by a save that is refused after the writing is done.
 */
export const MAX_SESSION_CONTENT = 20_000

/**
 * What an entry is called when it has no opening line.
 *
 * The journal asks for one piece of writing and fills the title column from its first line, so this stands in when there is none. It is also how an entry with nothing written is recognised: Explore drops the ones carrying it alongside empty content, which are cards with no words on them.
 */
export const DEFAULT_SESSION_TITLE = "Work session"

export const sessionCreateSchema = z
	.object({
		phase: phaseSchema,
		title: boundedText(200, 1),
		content: boundedText(MAX_SESSION_CONTENT).optional(),
		// A sanity bound, not a policy.
		hoursClaimed: z.number().min(0).max(MAX_SESSION_HOURS),
		/**
		 * MANUAL counts toward the journal total; HACKATIME_TRACKED does not, because those hours already arrive through the linked project.
		 */
		hoursSource: z.enum(HoursSource).default("MANUAL"),
		media: z.array(mediaSchema).max(10).default([]),
		/**
		 * Uncapped, because the picker does not cap: it lists every timelapse the maker has, and a cap the sheet does not enforce is a save refused after the clips were chosen. The work it does is bounded anyway – one verified clip per row written, against rows this account owns.
		 */
		timelapses: z.array(timelapseSchema).default([]),
	})
	.strict()

export const sessionUpdateSchema = sessionCreateSchema.partial().strict()

export type SessionCreateInput = z.infer<typeof sessionCreateSchema>
