import { ParticipantGoal } from "@/app/generated/prisma/enums"

/**
 * What a participant is here for.
 *
 * One question, asked once the first checkpoint is done and answered before the platform lets them carry on. Three answers, and they want genuinely different things from the same ten weeks – which is why the question has to be asked rather than inferred from which machine somebody has taped to the wall.
 *
 * The copy lives here rather than in the modal because it is the program's vocabulary, not a UI string: staff report on these three by name, and the first line of each hint is what gets quoted back to us. Changing a word here changes what people are told and what the data means at once, so it should be an edit that is hard to make by accident.
 *
 * The order is the order they are read in, and it is deliberate: the printer is first because it is the answer most people arrive with, and funding is second because it is the one the program most needs to hear. Neither funding answer is a lesser version of the other – "some weeks" is a real answer and is not phrased as a smaller version of "all of them".
 */
export interface GoalOption {
	readonly value: ParticipantGoal
	readonly label: string
	/** The one line that goes under the label, and the thing staff quote. */
	readonly hint: string
}

export const GOAL_OPTIONS: readonly GoalOption[] = [
	{
		value: ParticipantGoal.PRINTER,
		label: "A 3D printer",
		hint: "Work towards one of the eight printers at the end of the season.",
	},
	{
		value: ParticipantGoal.FULL_FUNDING,
		label: "Just funding, for all ten weeks",
		hint: "The per-project hardware grant, every week, and no prize to pace against.",
	},
	{
		value: ParticipantGoal.PARTIAL_FUNDING,
		label: "Funding for some of the weeks",
		hint: "Join for part of the run and claim the grant on the weeks you're here for.",
	},
]

