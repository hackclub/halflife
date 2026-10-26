import "server-only"
import { AuditAction, logAuditTx } from "@/lib/audit"
import authDb from "@/lib/auth-db"
import { PostStatus } from "@/lib/enums"
import { HttpError } from "@/lib/errors"
import db, { type DbOrTx } from "@/lib/prisma8"
import { formatDbTimestamp, parseDbTimestamp } from "@/lib/time"

/**
 * The penalties: suspension and ban.
 *
 * They are fields on User rather than rows of their own table, for the reason a reel's takedown is also columns on the post: one row is the whole truth, "is this account allowed on" stays a predicate on the read every request already makes, and no second lookup or stale join can disagree with it. A suspension is temporary by definition - it carries its own end - while a ban is open-ended.
 *
 * Only one penalty is held at a time. Two at once is a support ticket waiting to be written, since nothing else in the platform describes a state that is both.
 */

export type Penalty = "none" | "suspended" | "banned"

/**
 * Whether a suspension timestamp still binds.
 *
 * A suspension past its own end that was never unsuspended is expired, not forgotten: the read answers inactive so nobody is locked out later than the date an admin chose. The row keeps the history until it is cleared or replaced.
 */
export function isSuspensionActive(until: string | null | undefined): boolean {
	if (!until) return false
	return parseDbTimestamp(until).getTime() > Date.now()
}

/** Which penalty is on right now, given the timestamps a request read carries. A pending ban wins over an expired suspension; neither is ever both. */
export function penaltyFor(bannedAt: string | null | undefined, suspendedUntil: string | null | undefined): Penalty {
	if (bannedAt) return "banned"
	if (isSuspensionActive(suspendedUntil ?? null)) return "suspended"
	return "none"
}

/**
 * Kill every live session a user holds.
 *
 * better-auth keeps its sessions in their own tables through its own pool (lib/auth-db), and a signed-in session cookie may be served for minutes before re-checking - so removing the rows is what ends the ban at once rather than at the next re-read. The guard's own user-row read catches anything the cookie cache still answers in between.
 */
async function revokeSessions(userId: string): Promise<void> {
	try {
		await authDb.deleteFrom("session").where("userId", "=", userId).execute()
	} catch (err) {
		console.error(`[moderation] could not revoke sessions for ${userId}:`, err)
	}
}

/**
 * Recount the live comments under this member's posts, after a bulk hide or restore changed what "live" means.
 *
 * Each feed writer bumps `commentCount` by ±1; a bulk action must not replay that arithmetic over every row it touched, so this simply recomputes the truth. One statement for every post with any comment changed, inside the caller's transaction.
 */
async function resyncCommentCounts(tx: DbOrTx, userId: string): Promise<void> {
	const plan = tx.raw
		.sql`UPDATE "post" SET "commentCount" = (SELECT COUNT(*) FROM "post_comment" WHERE "post_comment"."postId" = "post"."id" AND "post_comment"."deletedAt" IS NULL AND "post_comment"."hiddenAt" IS NULL) WHERE "id" IN (SELECT "postId" FROM "post_comment" WHERE "userId" = ${userId} AND "deletedAt" IS NULL)`
		.affectedCount()
		.build()
	await tx.query(plan)
}

async function readTargetState(
	tx: DbOrTx,
	userId: string,
): Promise<{ bannedAt: string | null; suspendedUntil: string | null } | null> {
	const user = await tx.orm.public.User.whereUnique({ id: userId }).select("bannedAt", "suspendedUntil").first()
	return user
}

/**
 * Put a member on read-only until `until`.
 *
 * Refused while a ban stands: lifting a ban is its own decision, not a side effect of choosing to suspend. An already-running suspension is extended rather than errored - "suspend until Friday" on a Monday to a member suspended for three more days is one action said twice, not a conflict.
 */
export async function suspendUser(input: { byId: string; reason: string; until: Date; userId: string }): Promise<void> {
	await db.transaction(async tx => {
		const before = await readTargetState(tx, input.userId)
		if (!before) throw new HttpError("NOT_FOUND", "User not found")
		if (before.bannedAt) throw new HttpError("CONFLICT", "User is banned - lift the ban before suspending")

		await tx.orm.public.User.whereUnique({ id: input.userId }).update({
			suspendedById: input.byId,
			suspendedUntil: formatDbTimestamp(input.until),
			suspensionReason: input.reason,
		})

		await logAuditTx(tx, {
			action: AuditAction.ADMIN_SUSPEND_USER,
			actorId: input.byId,
			metadata: { after: { until: formatDbTimestamp(input.until) }, before },
			targetId: input.userId,
			targetType: "User",
		})
	})
}

/**
 * Ban a member.
 *
 * The steps are ordered by speed on purpose: the row is written and the action logged inside one transaction, and the sessions are only cut after it commits, since a failed session cut must not fail a ban - the guard's user-row read would still deny the member access within seconds even if the session rows somehow survived.
 */
export async function banUser(input: {
	byId: string
	hideContent: boolean
	reason: string
	userId: string
}): Promise<void> {
	await db.transaction(async tx => {
		const before = await readTargetState(tx, input.userId)
		if (!before) throw new HttpError("NOT_FOUND", "User not found")
		if (before.bannedAt) throw new HttpError("CONFLICT", "User is already banned")

		// A ban replaces a suspension rather than sitting under it: only one state can hold, so the stronger of the two is written and the other is withdrawn.
		await tx.orm.public.User.whereUnique({ id: input.userId }).update({
			bannedAt: formatDbTimestamp(new Date()),
			bannedById: input.byId,
			banReason: input.reason,
			suspendedById: null,
			suspendedUntil: null,
			suspensionReason: null,
		})

		if (input.hideContent) await hideAllContent(tx, input.userId, input.byId, input.reason)

		await logAuditTx(tx, {
			action: AuditAction.ADMIN_BAN_USER,
			actorId: input.byId,
			metadata: { after: { hideContent: input.hideContent }, before },
			targetId: input.userId,
			targetType: "User",
		})
	})

	await revokeSessions(input.userId)
}

export async function unsuspendUser(input: { byId: string; userId: string }): Promise<void> {
	await db.transaction(async tx => {
		const before = await readTargetState(tx, input.userId)
		if (!before) throw new HttpError("NOT_FOUND", "User not found")
		if (!before.suspendedUntil) throw new HttpError("CONFLICT", "User is not suspended")

		await tx.orm.public.User.whereUnique({ id: input.userId }).update({
			suspendedById: null,
			suspendedUntil: null,
			suspensionReason: null,
		})

		await logAuditTx(tx, {
			action: AuditAction.ADMIN_UNSUSPEND_USER,
			actorId: input.byId,
			metadata: { before },
			targetId: input.userId,
			targetType: "User",
		})
	})
}

/**
 * Lift a ban.
 *
 * `restoreContent` reverses exactly what the ban hid - the rows stamped `hiddenByBanAt` at ban time - so content a moderator hid separately, for a reason of its own, stays hidden. Content the member deleted themselves stays deleted.
 */
export async function unbanUser(input: { byId: string; restoreContent: boolean; userId: string }): Promise<void> {
	await db.transaction(async tx => {
		const before = await readTargetState(tx, input.userId)
		if (!before) throw new HttpError("NOT_FOUND", "User not found")
		if (!before.bannedAt) throw new HttpError("CONFLICT", "User is not banned")

		await tx.orm.public.User.whereUnique({ id: input.userId }).update({
			bannedAt: null,
			bannedById: null,
			banReason: null,
		})

		if (input.restoreContent) await restoreAllContent(tx, input.userId)

		await logAuditTx(tx, {
			action: AuditAction.ADMIN_UNBAN_USER,
			actorId: input.byId,
			metadata: { before, restoreContent: input.restoreContent },
			targetId: input.userId,
			targetType: "User",
		})
	})
}

// ─── Bulk content hide/restore, done by the ban and undone by an unban ───────

/**
 * Hide every reel and comment the member published, through the same soft-hide the feed's own moderation writes, plus a `hiddenByBanAt` stamp marking it as something the ban did.
 *
 * The stamp is what makes "restore" safe: only rows the ban touched carry it, so a separate moderator hide for a separate reason survives the unban untouched. Feeds pass through the same `visible` predicate as always - nothing about a bulk ban may quietly force-feed other code paths a different rule.
 */
async function hideAllContent(tx: DbOrTx, userId: string, moderatorId: string, reason: string): Promise<void> {
	const now = formatDbTimestamp(new Date())

	// Only PUBLISHED reels become HIDDEN: a reel still PROCESSING or already REMOVED keeps its own state.
	await tx.orm.public.Post.where({ deletedAt: null, userId })
		.where(post => post.status.eq(PostStatus.PUBLISHED))
		.where(post => post.hiddenAt.isNull())
		.update({
			hiddenAt: now,
			hiddenByBanAt: now,
			hiddenById: moderatorId,
			hiddenReason: reason,
			status: PostStatus.HIDDEN,
		})

	await tx.orm.public.PostComment.where({ deletedAt: null, userId })
		.where(comment => comment.hiddenAt.isNull())
		.update({ hiddenAt: now, hiddenByBanAt: now, hiddenById: moderatorId, hiddenReason: reason })

	await resyncCommentCounts(tx, userId)
}

/** The unban's counterpart: clear the ban stamp, and with it the hide the ban wrote. */
async function restoreAllContent(tx: DbOrTx, userId: string): Promise<void> {
	await tx.orm.public.Post.where({ deletedAt: null, userId })
		.where(post => post.hiddenByBanAt.isNotNull())
		.update({
			hiddenAt: null,
			hiddenByBanAt: null,
			hiddenById: null,
			hiddenReason: null,
			status: PostStatus.PUBLISHED,
		})

	await tx.orm.public.PostComment.where({ deletedAt: null, userId })
		.where(comment => comment.hiddenByBanAt.isNotNull())
		.update({ hiddenAt: null, hiddenByBanAt: null, hiddenById: null, hiddenReason: null })

	await resyncCommentCounts(tx, userId)
}
