import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Close a report as no violation. */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_FEED)
	if (gate.error) return gate.error
	const { id } = await params

	const report = await prisma.contentReport.findUnique({ where: { id }, select: { status: true } })
	if (!report) return fail("NOT_FOUND", "Report not found")
	if (report.status !== "OPEN") return fail("CONFLICT", "This report was already decided")

	// Conditional, so two admins deciding at once cannot both succeed: the loser matches no OPEN row and gets the same conflict as a late arrival.
	const updated = await prisma.contentReport.updateMany({
		where: { id, status: "OPEN" },
		data: { status: "DISMISSED", resolvedAt: new Date(), resolvedById: gate.user.id },
	})
	if (updated.count === 0) return fail("CONFLICT", "This report was already decided")

	await logAudit({
		action: AuditAction.ADMIN_DISMISS_REPORT,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ContentReport",
		targetId: id,
	})

	return ok({ dismissed: true })
})
