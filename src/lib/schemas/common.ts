import { z } from "zod"
import { Phase } from "@/app/generated/prisma/enums"

export const cuid = z.string().min(1).max(64)

export const phaseSchema = z.enum(Phase)

/** Rejects javascript:, data:, http: and friends – a URL field is not a script host. */
export const httpsUrl = z
	.string()
	.trim()
	.max(1000)
	.refine(v => {
		try {
			const parsed = new URL(v)
			return parsed.protocol === "https:"
		} catch {
			return false
		}
	}, "Must be an https URL")

export function boundedText(max: number, min = 0): z.ZodString {
	return z.string().trim().min(min).max(max)
}

/**
 * Whether `timeZone` is an IANA name this runtime knows, e.g. "Asia/Kolkata".
 *
 * Every program-time computation runs the zone through `Intl.DateTimeFormat`, and that throws `RangeError: invalid time zone` on anything else – so a name that is not a zone has to be refused where it is typed, not where it is used. One typo in the program's timezone would otherwise brick every trail snapshot, every session write, the streak recompute and the admin program page at once.
 */
export function isTimeZone(timeZone: string): boolean {
	try {
		// Formatted to prove the zone works: an unknown one is a RangeError from the formatter, and that is what says the name is not one this runtime knows.
		new Intl.DateTimeFormat("en-US", { timeZone }).format()
		return true
	} catch {
		return false
	}
}
