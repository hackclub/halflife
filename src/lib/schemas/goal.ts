import { z } from "zod"
import { ParticipantGoal } from "@/app/generated/prisma/enums"

/**
 * Answering "what are you here for", optionally with the machine.
 *
 * `.strict()` so a mistyped field is a 400 rather than a silently dropped one, and `printerGoalId` is optional because the two funding answers do not carry one. The route refuses a printer goal with no machine, and a funding answer with one – the shape is loose here on purpose, and settled in one place there, so the two rules live next to each other instead of at both ends of the app.
 */
export const setGoalSchema = z
	.object({
		goal: z.enum(ParticipantGoal),
		printerGoalId: z.string().max(80).optional(),
	})
	.strict()
