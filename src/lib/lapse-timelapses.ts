import { z } from "zod"
import { errorMessage, refusalMessage } from "@/lib/api-error"
import { isRecord } from "@/lib/unknown"

/**
 * The timelapse picker's client contract.
 *
 * Kept apart from the component so the shape can be tested without a browser: the two bodies this reads – a page of timelapses and a refusal – share no fields, and reading a refusal against the page schema is what once left every failure showing a generic message.
 */

/** One timelapse as the picker's routes send it. */
export const LapseTimelapseSchema = z.object({
	attached: z.boolean(),
	createdAt: z.number(),
	durationSeconds: z.number(),
	hackatimeProject: z.string().nullable(),
	id: z.string(),
	processing: z.boolean(),
	thumbnailUrl: z.string().nullable(),
	title: z.string(),
	visibility: z.enum(["PUBLIC", "UNLISTED", "FAILED_PROCESSING"]),
})
export type LapseTimelapse = z.infer<typeof LapseTimelapseSchema>

/** A page of timelapses: the route's success body, with none of a refusal's fields. */
const LapsePageResponseSchema = z.object({
	nextCursor: z.string().nullable(),
	timelapses: z.array(LapseTimelapseSchema),
})

export type LapsePageRead =
	| { unlinked: true }
	| { error: string }
	| { page: { nextCursor: string | null; timelapses: LapseTimelapse[] } }

/** The code in the route's refusal envelope, read without assuming the body is one. */
function errorCodeOf(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined
	const { error } = payload
	if (!isRecord(error)) return undefined
	const { code } = error
	return typeof code === "string" ? code : undefined
}

/**
 * Read one answer from `/api/lapse/timelapses`.
 *
 * A refusal is read for its own envelope first: the route sends `{ error: { code, message } }` with none of a page's fields, so parsing it as a page can only ever fail. A Lapse link that has expired comes back as `LAPSE_NOT_LINKED` and is the one refusal the picker answers with the sign-in card rather than an error, because signing in is the fix.
 */
export function readLapsePage(status: number, payload: unknown): LapsePageRead {
	if (status >= 400) {
		if (errorCodeOf(payload) === "LAPSE_NOT_LINKED") return { unlinked: true }
		return { error: errorMessage(payload, refusalMessage(status, "The timelapse list could not be loaded")) }
	}
	const parsed = LapsePageResponseSchema.safeParse(payload)
	if (!parsed.success) {
		// A 200 we cannot read is drift between the route and this shape, not something the maker can act on: log it and say the list came back unreadable.
		console.error("[lapse] unreadable timelapse list:", parsed.error)
		return { error: "The timelapse list came back unreadable. Try again, and let us know if it keeps happening." }
	}
	return { page: parsed.data }
}
