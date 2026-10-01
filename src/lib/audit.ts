import "server-only"
import { headers } from "next/headers"
import type { Prisma } from "@/app/generated/prisma/client"
import { AuditAction } from "@/app/generated/prisma/enums"
import prisma from "@/lib/prisma"

export { AuditAction }

export interface AuditInput {
	action: AuditAction
	actorId?: string | null
	actorEmail?: string | null
	targetType?: string | null
	targetId?: string | null
	/**
	 * Record what changed, not just that something changed:
	 * `{ before: { tier: null }, after: { tier: 2 } }`. Six weeks later the
	 * question is always "why does this person have 340 credits", and only a
	 * before/after answers it.
	 */
	metadata?: Prisma.InputJsonValue
}

async function requestInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
	try {
		const h = await headers()
		const forwarded = h.get("x-forwarded-for")
		const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || h.get("cf-connecting-ip") || null
		return { ip, userAgent: h.get("user-agent") }
	} catch {
		// Called outside a request scope (a cron script). Not an error.
		return { ip: null, userAgent: null }
	}
}

/**
 * Best-effort by design: an audit write must never fail the user's request.
 * It logs loudly instead, so a broken audit trail is discoverable rather than
 * silent.
 */
export async function logAudit(input: AuditInput): Promise<void> {
	try {
		const { ip, userAgent } = await requestInfo()
		await prisma.auditLog.create({
			data: {
				action: input.action,
				actorId: input.actorId ?? null,
				actorEmail: input.actorEmail ?? null,
				actorIp: ip,
				actorUserAgent: userAgent,
				targetType: input.targetType ?? null,
				targetId: input.targetId ?? null,
				metadata: input.metadata,
			},
		})
	} catch (err) {
		console.error(`[audit] failed to record ${input.action}:`, err)
	}
}

/**
 * Audit write that participates in a transaction. Use this only when
 * correctness depends on the log landing with the mutation (credit grants,
 * role changes); everything else should use logAudit so a slow insert doesn't
 * hold a row lock.
 */
export async function logAuditTx(
	tx: Prisma.TransactionClient,
	input: AuditInput & { ip?: string | null; userAgent?: string | null },
): Promise<void> {
	await tx.auditLog.create({
		data: {
			action: input.action,
			actorId: input.actorId ?? null,
			actorEmail: input.actorEmail ?? null,
			actorIp: input.ip ?? null,
			actorUserAgent: input.userAgent ?? null,
			targetType: input.targetType ?? null,
			targetId: input.targetId ?? null,
			metadata: input.metadata,
		},
	})
}
