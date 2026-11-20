import "server-only"
import { displayName } from "@/lib/display-name"
import { penaltyFor } from "@/lib/moderation"
import { PERMISSION_COUNT, PERMISSION_LEVEL_LABELS, permissionSummary, readablePermission } from "@/lib/permissions"
import type { DirectoryUser } from "@/lib/queries/admin"

/**
 * One line of the user directory, already worked out on the server. The client cannot compute these itself, because the permission and penalty rules are server-only, so the list sends rows like this rather than raw accounts.
 */
export interface DirectoryRow {
	email: string
	fraudFlagged: boolean
	granted: string[]
	grantedCount: number
	id: string
	joined: string
	level: string
	levelLabel: string
	name: string
	penalty: string
	permissionTotal: number
	roles: string[]
	/** Null unless the caller may see contact details, the same as the email. */
	slackId: string | null
	verified: string
}

export const toDirectoryRow = (user: DirectoryUser): DirectoryRow => {
	const summary = permissionSummary(user.roles.map(entry => entry.role))
	return {
		email: user.email,
		fraudFlagged: user.fraudFlagged,
		granted: summary.permissions.map(readablePermission),
		grantedCount: summary.permissions.length,
		id: user.id,
		joined: user.createdAt.toISOString(),
		level: summary.level,
		levelLabel: PERMISSION_LEVEL_LABELS[summary.level],
		name: displayName(user) ?? "-",
		penalty: penaltyFor(user.bannedAt, user.suspendedUntil),
		permissionTotal: PERMISSION_COUNT,
		roles: user.roles.map(entry => entry.role.toLowerCase()),
		slackId: user.slackId,
		verified: user.verificationStatus ?? "unknown",
	}
}
