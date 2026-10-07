import { fail, ok, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Close a report as reviewed. Taking the thing down stays a separate action. */
export const POST = withRoute(async (_req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.MANAGE_FEED)
	if (gate.error) return gate.error
	const { id } = await params

	const report = await prisma.contentReport.findUnique({ where: { id }, select: { status: true } })
	if (!report) return fail("NOT_FOUND", "Report not found")
	if (report.status !== "OPEN") return fail("CONFLICT", "This report was already decided")

	await prisma.contentReport.update({
		where: { id },
		data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: gate.user.id },
	})

	await logAudit({
		action: AuditAction.ADMIN_RESOLVE_REPORT,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "ContentReport",
		targetId: id,
	})

	return ok({ resolved: true })
})
