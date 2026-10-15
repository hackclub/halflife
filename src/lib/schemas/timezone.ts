import { z } from "zod"
import { boundedText } from "@/lib/schemas/common"

/**
 * The browser's IANA zone, sent once so an account can be placed on the admin overview's geography panels.
 *
 * A plain string here; whether the runtime actually knows the zone is `isTimeZone`'s answer, checked in the route rather than in this shape so the refusal can name the value.
 */
export const timezonePreferenceSchema = z
	.object({
		timezone: boundedText(64, 1),
	})
	.strict()
