import { z } from "zod"
import { HoursSource, MediaType } from "@/app/generated/prisma/enums"
import { boundedText, phaseSchema } from "@/lib/schemas/common"

const mediaSchema = z.object({
	byteSize: z.number().int().positive().optional(),
	contentType: z.string().max(120).optional(),
	objectKey: z.string().min(1).max(500),
	type: z.enum(MediaType),
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

/**
 * How many timelapses one entry may hold.
 *
 * Capped because every id is checked with its own request to Lapse, so a body carrying a few thousand ids would otherwise fire a few thousand concurrent requests at a third party. The same cap the resolve route reads.
 */
export const MAX_SESSION_TIMELAPSES = 25

export const sessionCreateSchema = z
	.object({
		content: boundedText(MAX_SESSION_CONTENT).optional(),
		// A sanity bound, not a policy.
		hoursClaimed: z.number().min(0).max(MAX_SESSION_HOURS),
		/**
		 * MANUAL counts toward the journal total; HACKATIME_TRACKED does not, because those hours already arrive through the linked project.
		 */
		hoursSource: z.enum(HoursSource).default("MANUAL"),
		media: z.array(mediaSchema).max(10).default([]),
		phase: phaseSchema,
		/**
		 * Capped, because each id costs a round trip to Lapse. The picker itself does not cap how many clips a maker may tick – so the cap is a server-side bound on the work one request may cause, not a promise about the sheet.
		 */
		timelapses: z
			.array(timelapseSchema)
			.max(MAX_SESSION_TIMELAPSES, `An entry can hold at most ${MAX_SESSION_TIMELAPSES} timelapses`)
			.default([]),
		title: boundedText(200, 1),
	})
	.strict()

/**
 * Editing an entry does not touch its images: the PATCH route writes the title, the content, the claimed hours and the source, and nothing else. `media` is left out so the shape says what the route does, rather than accepting a field and dropping it.
 */
export const sessionUpdateSchema = sessionCreateSchema.omit({ media: true }).partial().strict()
