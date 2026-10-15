import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { resolveDisputeSchema } from "@/lib/schemas/admin"

type Params = { params: Promise<{ id: string }> }

/**
 * Close a maker's dispute.
 *
 * Resolving does not change the decision; it records that a person looked again. Changing the outcome is the review path's job (`Override decisions`), so this cannot become a second, quieter way to approve something.
 */
export const POST = withRoute(async (req: Request, { params }: Params) => {
	const gate = await requirePermission(Permission.OVERRIDE_DECISIONS)
	if (gate.error) return gate.error
	const { id } = await params

	const parsed = await parseBody(req, resolveDisputeSchema)
	if (parsed.error) return parsed.error

	const closed = await prisma.reviewDispute.updateMany({
		data: { resolutionNote: parsed.data.note ?? null, resolvedAt: new Date(), resolvedById: gate.user.id },
		where: { id, resolvedAt: null },
	})
	if (closed.count === 0) return fail("CONFLICT", "That dispute is already resolved")

	await logAudit({
		action: AuditAction.ADMIN_RESOLVE_DISPUTE,
		actorEmail: gate.user.email,
		actorId: gate.user.id,
		metadata: { note: parsed.data.note ?? null },
		targetId: id,
		targetType: "ReviewDispute",
	})

	return ok({ resolved: true })
})
