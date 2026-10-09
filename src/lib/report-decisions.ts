import "server-only"
import { fail, ok } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import type { Guard } from "@/lib/guards"
import prisma from "@/lib/prisma"

/**
 * The two ways a staff member closes a report, which are one operation apart.
 *
 * Resolve means a violation happened and something was taken down; dismiss means no violation did. Both are recorded on the same row, both refuse a report that is already decided, and both were two routes differing in three tokens – the status, the audit action and the key in the reply.
 *
 * Kept as one function rather than one route with a parameter so the two reply shapes stay distinct. A caller that asked for `dismissed` must not be handed `{ resolved: true }`: the client renders that key as the confirmation, and a mismatch would show a success message for an outcome that did not happen.
 */
export type Outcome = "RESOLVED" | "DISMISSED"

/** The reply key each outcome reports itself under. */
const replyKey: Record<Outcome, "resolved" | "dismissed"> = {
	RESOLVED: "resolved",
	DISMISSED: "dismissed",
}

const auditAction: Record<Outcome, AuditAction> = {
	RESOLVED: AuditAction.ADMIN_RESOLVE_REPORT,
	DISMISSED: AuditAction.ADMIN_DISMISS_REPORT,
}

export async function decideReport(
	gate: Guard & { user: { id: string; email: string } },
	id: string,
	outcome: Outcome,
) {
	const report = await prisma.contentReport.findUnique({ where: { id }, select: { status: true } })
	if (!report) return fail("NOT_FOUND", "Report not found")
	if (report.status !== "OPEN") return fail("CONFLICT", "This report was already decided")

	// Conditional, so two admins deciding at once cannot both succeed: the loser matches no OPEN row and gets the same conflict as a late arrival.
	const updated = await prisma.contentReport.updateMany({
		where: { id, status: "OPEN" },
		data: { status: outcome, resolvedAt: new Date(), resolvedById: gate.user.id },
	})
	if (updated.count === 0) return fail("CONFLICT", "This report was already decided")

	await logAudit({
		action: auditAction[outcome],
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ContentReport",
		targetId: id,
	})

	return ok({ [replyKey[outcome]]: true })
}
