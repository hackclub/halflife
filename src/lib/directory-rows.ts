import "server-only"
import { rsvpUrlsByUser } from "@/lib/airtable/links"
import { displayName } from "@/lib/display-name"
import { penaltyFor } from "@/lib/moderation"
import { PERMISSION_COUNT, PERMISSION_LEVEL_LABELS, permissionSummary, readablePermission } from "@/lib/permissions"
import type { DirectoryUser } from "@/lib/queries/admin"

/**
 * One line of the user directory, already worked out on the server. The client cannot compute these itself, because the permission and penalty rules are server-only, so the list sends rows like this rather than raw accounts.
 */
export interface DirectoryRow {
	/** The account's Signups row in Airtable. Null unless the caller may see contact details, the same as the email. */
	airtableUrl: string | null
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

export const toDirectoryRow = (user: DirectoryUser, airtableUrl: string | null): DirectoryRow => {
	const summary = permissionSummary(user.roles.map(entry => entry.role))
	return {
		airtableUrl,
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

/** A page of the directory as rows. The Airtable links are read only for callers who may see contact details, so the rest of the directory never reads Airtable at all. */
export async function toDirectoryRows(users: DirectoryUser[], includePii: boolean): Promise<DirectoryRow[]> {
	const links = includePii ? await rsvpUrlsByUser(users.map(user => user.id)) : new Map<string, string>()
	return users.map(user => toDirectoryRow(user, links.get(user.id) ?? null))
}
