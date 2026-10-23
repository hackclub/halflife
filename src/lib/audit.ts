import "server-only"
import { headers } from "next/headers"
import type { Prisma } from "@/app/generated/prisma/client"
import type { AuditAction } from "@/app/generated/prisma/enums"
import { clientIp } from "@/lib/client-ip"
import prisma from "@/lib/prisma"

interface AuditInput {
	action: AuditAction
	actorEmail?: string | null
	actorId?: string | null
	/**
	 * Record what changed, not just that something changed: `{ before: { tier: null }, after: { tier: 2 } }`. Six weeks later the question is always "why does this person have 340 credits", and only a before/after answers it.
	 */
	metadata?: Prisma.InputJsonValue
	targetId?: string | null
	targetType?: string | null
}

/**
 * The caller's address and browser, as the audit trail records them.
 *
 * Exported because `logAuditTx` cannot read them itself: it joins a transaction, and `headers()` is
 * request-scoped, so the caller has to resolve them here and pass them in.
 */
async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers()
		const ip = clientIp(h)
		return { ip: ip === "unknown" ? null : ip, userAgent: h.get("user-agent") }
	} catch {
		// Called outside a request scope (a cron script). Not an error.
		return { ip: null, userAgent: null }
	}
}

/**
 * Best-effort by design: an audit write must never fail the user's request. It logs loudly instead, so a broken audit trail is discoverable rather than silent.
 */
async function logAudit(input: AuditInput): Promise<void> {
	try {
		const { ip, userAgent } = await requestInfo()
		await prisma.auditLog.create({
			data: {
				action: input.action,
				actorEmail: input.actorEmail ?? null,
				actorId: input.actorId ?? null,
				actorIp: ip,
				actorUserAgent: userAgent,
				metadata: input.metadata,
				targetId: input.targetId ?? null,
				targetType: input.targetType ?? null,
			},
		})
	} catch (err) {
		console.error(`[audit] failed to record ${input.action}:`, err)
	}
}

/**
 * Audit write that participates in a transaction. Use this only when correctness depends on the log landing with the mutation (credit grants, role changes); everything else should use logAudit so a slow insert doesn't hold a row lock.
 */
async function logAuditTx(
	tx: Prisma.TransactionClient,
	input: AuditInput & { ip?: string | null; userAgent?: string | null },
): Promise<void> {
	await tx.auditLog.create({
		data: {
			action: input.action,
			actorEmail: input.actorEmail ?? null,
			actorId: input.actorId ?? null,
			actorIp: input.ip ?? null,
			actorUserAgent: input.userAgent ?? null,
			metadata: input.metadata,
			targetId: input.targetId ?? null,
			targetType: input.targetType ?? null,
		},
	})
}

export { AuditAction } from "@/app/generated/prisma/enums"
export { type AuditInput, logAudit, logAuditTx, requestInfo }
