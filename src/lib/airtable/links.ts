import "server-only"
import { RSVP, YSWS_SUBMISSION } from "@/lib/airtable/schema"
import { recordIdsFromSyncEvents } from "@/lib/airtable/sync"
import { Phase } from "@/lib/enums"
import db from "@/lib/prisma8"

/** One project's Airtable rows, by phase. A phase that never reached Airtable has no key. */
export interface ProjectAirtableLinks {
	BUILD?: string
	DESIGN?: string
}

/**
 * The web address of one Airtable record, or null when the base is not configured. Built here rather than in the browser so the base id stays server-side with the rest of the Airtable setup.
 */
export function airtableRecordUrl(tableId: string, recordId: string): string | null {
	const baseId = process.env.AIRTABLE_BASE_ID
	if (!baseId) return null
	return `https://airtable.com/${baseId}/${encodeURIComponent(tableId)}/${recordId}`
}

/** The Signups row each account is linked to by its user id, keyed by user. An account with no row is left out. */
export async function rsvpUrlsByUser(userIds: readonly string[]): Promise<Map<string, string>> {
	const urls = new Map<string, string>()
	if (userIds.length === 0) return urls
	const rows = await db.orm.public.RsvpBuffer.where(row => row.userId.in([...userIds]))
		.where(row => row.airtableRecordId.isNotNull())
		.select("airtableRecordId", "userId")
		.all()
	for (const row of rows) {
		if (!row.userId || !row.airtableRecordId || urls.has(row.userId)) continue
		const url = airtableRecordUrl(RSVP.tableId, row.airtableRecordId)
		if (url) urls.set(row.userId, url)
	}
	return urls
}

/** Each project's design and build rows in the YSWS submission table, keyed by project. A project with neither is left out. */
export async function projectAirtableLinks(projectIds: readonly string[]): Promise<Map<string, ProjectAirtableLinks>> {
	const links = new Map<string, ProjectAirtableLinks>()
	if (projectIds.length === 0) return links
	const events = await db.orm.public.AuditLog.where({ action: "AIRTABLE_SYNC_SUCCESS" })
		.where(entry => entry.targetId.in([...projectIds]))
		.orderBy(entry => entry.createdAt.desc())
		.select("metadata", "targetId")
		.all()
	const recordIds = recordIdsFromSyncEvents(events)
	for (const projectId of projectIds) {
		const found: ProjectAirtableLinks = {}
		for (const phase of Object.values(Phase)) {
			const recordId = recordIds.get(`${projectId}:${phase}`)
			const url = recordId ? airtableRecordUrl(YSWS_SUBMISSION.tableId, recordId) : null
			if (url) found[phase] = url
		}
		if (Object.keys(found).length > 0) links.set(projectId, found)
	}
	return links
}
