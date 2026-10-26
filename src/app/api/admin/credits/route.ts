import { fail, ok, parseBody } from "@/lib/api"
import { AuditAction, logAuditTx, requestInfo } from "@/lib/audit"
import { appendLedgerEntry, CoinBucket, getBalances, LedgerKind, lockUserCredit } from "@/lib/currency"
import { withPermission } from "@/lib/guards"
import { isIdentityVerified } from "@/lib/hca-profile"
import { Permission } from "@/lib/permissions"
import db from "@/lib/prisma8"
import { sanitize } from "@/lib/sanitize"
import { creditAdjustSchema } from "@/lib/schemas/admin"

export const POST = withPermission(Permission.MANAGE_CREDIT, async (req: Request, { gate }) => {
	const parsed = await parseBody(req, creditAdjustSchema)
	if (parsed.error) return parsed.error
	const { userId, amount, reason, bucket } = parsed.data

	const target = await db.orm.public.User.whereUnique({ id: userId }).select("id").first()
	if (!target) return fail("NOT_FOUND", "User not found")

	// Issuing coins is a reward, so the maker has to have cleared HCA's identity check first. A clawback is not a reward and is still allowed: taking credit back must not be blocked by the state of the account it is taken from. Asked before the transaction, because `isIdentityVerified` may call HCA and that must not hold a lock.
	if (amount > 0 && !(await isIdentityVerified(userId)))
		return fail(
			"NOT_VERIFIED",
			"Coins can only be granted to a maker whose identity is verified. Ask them to verify at identity.hackclub.com, or make a negative adjustment to claw credit back.",
		)

	// Read here rather than inside the transaction: `headers()` is request-scoped, and the audit row has to carry the address and browser of the admin who made the adjustment.
	const { ip, userAgent } = await requestInfo()

	const entry = await db
		.transaction(async tx => {
			await lockUserCredit(tx, userId)
			const balances = await getBalances(tx, userId)
			// Guard the pot being moved, not the combined total: a clawback that the total can absorb may still take the spendable pot negative, and banked coins are not available to cover it.
			const balance = bucket === "BANKED" ? balances.banked : balances.spendable
			// A negative balance is not a state the shop or any display knows how to render, so refuse rather than create one.
			if (balance + amount < 0)
				throw Object.assign(new Error("Would drive the balance negative"), {
					__insufficient: true,
					balance,
				})

			const created = await appendLedgerEntry(tx, {
				amount,
				bucket: bucket === "BANKED" ? CoinBucket.BANKED : CoinBucket.SPENDABLE,
				createdById: gate.user.id,
				kind: LedgerKind.ADMIN_ADJUSTMENT,
				note: sanitize(reason),
				userId,
			})

			// The trail joins the transaction, because a credit that outlives its audit row is the failure this route exists to prevent: `logAudit` swallows failures, so a row written after the commit can be missing entirely and nothing would notice. `logAuditTx` is the variant that refuses.
			await logAuditTx(tx, {
				action: AuditAction.ADMIN_ADJUST_CREDIT,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				ip,
				metadata: {
					after: created.balanceAfter,
					amount,
					before: created.balanceBefore,
					bucket,
					reason,
				},
				targetId: userId,
				targetType: "User",
				userAgent,
			})

			return created
		})
		.catch((err: unknown) => {
			if (err && typeof err === "object" && "__insufficient" in err) return null
			throw err
		})

	if (!entry) return fail("INSUFFICIENT_CREDIT", "That adjustment would make the balance negative")

	return ok({ entry }, { status: 201 })
})
