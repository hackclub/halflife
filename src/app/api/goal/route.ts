import { ParticipantGoal } from "@/app/generated/prisma/enums"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { PRINTERS } from "@/lib/config/printers"
import { requireSession } from "@/lib/guards"
import prisma from "@/lib/prisma"
import { setGoalSchema } from "@/lib/schemas/goal"

export const dynamic = "force-dynamic"

/**
 * What a participant is here for, and which printer if the answer is a printer.
 *
 * Both fields move in one write because they are one decision. Accepting a printer without the goal that justifies it, or a printer goal with no machine, would leave a row the rest of the platform cannot read honestly. This is also the only place `printerGoalId` is written: the printer is economically load-bearing (it sizes what every design approval mints into the printer fund), and one writer is easier to keep honest than two.
 *
 * Choosing a funding answer leaves `printerGoalId` exactly as it was rather than nulling it. Somebody who goes for funding this week and changes their mind next week gets their own machine back, not the default; and nothing already banked was ever paced against the wrong target, because the pace is read live from this column rather than frozen at approval.
 */
export const PATCH = withRoute(async (req: Request) => {
	const gate = await requireSession()
	if (gate.error) return gate.error

	const parsed = await parseBody(req, setGoalSchema)
	if (parsed.error) return parsed.error

	const { goal, printerGoalId } = parsed.data

	let printer: string | null = null
	if (goal === ParticipantGoal.PRINTER) {
		const found = printerGoalId ? PRINTERS.find((p) => p.id === printerGoalId) : null
		if (!found) return fail("VALIDATION_FAILED", "Pick a printer to go with that goal")
		printer = found.id
	}

	const before = await prisma.user.findUnique({
		where: { id: gate.user.id },
		select: { participantGoal: true, printerGoalId: true },
	})

	await prisma.user.update({
		where: { id: gate.user.id },
		data: { participantGoal: goal, ...(printer ? { printerGoalId: printer } : {}) },
	})

	const who = {
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "User",
		targetId: gate.user.id,
	}

	// The machine has its own audit trail because it is the part that moves money: every design approval from here on mints against it.
	if (printer && before?.printerGoalId !== printer) {
		await logAudit({ action: AuditAction.USER_SET_PRINTER_GOAL, ...who, metadata: { printerGoalId: printer } })
	}

	// The only interesting fact about a change is what it changed from, and for the two funding answers it is also the count the program reports on.
	await logAudit({
		action: AuditAction.USER_SET_PARTICIPANT_GOAL,
		...who,
		metadata: { from: before?.participantGoal ?? null, to: goal, printerGoalId: printer },
	})

	return ok({ participantGoal: goal, printerGoalId: printer })
})
