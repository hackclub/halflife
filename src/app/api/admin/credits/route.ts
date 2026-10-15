import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { appendLedgerEntry, CoinBucket, getBalances, LedgerKind, lockUserCredit } from "@/lib/currency"
import { requirePermission } from "@/lib/guards"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { creditAdjustSchema } from "@/lib/schemas/admin"

export const POST = withRoute(async (req: Request) => {
	const gate = await requirePermission(Permission.MANAGE_CREDIT)
	if (gate.error) return gate.error

	const parsed = await parseBody(req, creditAdjustSchema)
	if (parsed.error) return parsed.error
	const { userId, amount, reason, bucket } = parsed.data

	const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
	if (!target) return fail("NOT_FOUND", "User not found")

	const entry = await prisma
		.$transaction(async tx => {
			await lockUserCredit(tx, userId)
			const balances = await getBalances(tx, userId)
			// Guard the pot being moved, not the combined total: a clawback that the total can absorb may still take the spendable pot negative, and banked coins are not available to cover it.
			const balance = bucket === "BANKED" ? balances.banked : balances.spendable
			// A negative balance is not a state the shop or any display knows how to render, so refuse rather than create one.
			if (balance + amount < 0) {
				throw Object.assign(new Error("Would drive the balance negative"), {
					__insufficient: true,
					balance,
				})
			}
			return appendLedgerEntry(tx, {
				userId,
				kind: LedgerKind.ADMIN_ADJUSTMENT,
				bucket: bucket === "BANKED" ? CoinBucket.BANKED : CoinBucket.SPENDABLE,
				amount,
				note: sanitize(reason),
				createdById: gate.user.id,
			})
		})
		.catch((err: unknown) => {
			if (err && typeof err === "object" && "__insufficient" in err) return null
			throw err
		})

	if (!entry) return fail("INSUFFICIENT_CREDIT", "That adjustment would make the balance negative")

	await logAudit({
		action: AuditAction.ADMIN_ADJUST_CREDIT,
		actorId: gate.user.id,
		actorEmail: gate.user.email,
		targetType: "User",
		targetId: userId,
		metadata: {
			amount,
			reason,
			bucket,
			before: entry.balanceBefore,
			after: entry.balanceAfter,
		},
	})

	return ok({ entry }, { status: 201 })
})
