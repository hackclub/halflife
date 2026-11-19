import "server-only"
import db from "@/lib/prisma8"
import { parseDbTimestamp, parseNullableTimestamp } from "@/lib/time"

/** Where an extension hangs: the whole account, one program week, or one project. */
export type ExtensionKind = "user" | "week" | "project"

/** One live extension, whoever holds it and whatever it covers. */
export interface DeadlineExtension {
	email: string
	expiresAt: Date
	kind: ExtensionKind
	projectId: string | null
	projectTitle: string | null
	userDisplayName: string | null
	userId: string
	userName: string | null
	week: number | null
}

/** Every live extension, soonest first, plus how many expired ones stayed out of the list. */
export interface DeadlineSummary {
	expiredHidden: number
	items: DeadlineExtension[]
	projectActive: number
	userActive: number
	weekActive: number
}

/**
 * Every extension still running, from all three places one can hang.
 *
 * A user extension covers every project its owner holds, so passed weeks take journal entries again and work can be submitted past a global close. A week extension stays on the week and covers its project once one exists, including weeks with no project row yet. A project extension covers that project only. Only rows expiring in the future are listed; the expired count is reported so the page can say how many it hid.
 */
export async function listActiveExtensions(flags?: { includePii?: boolean }): Promise<DeadlineSummary> {
	const includePii = flags?.includePii ?? false
	const now = new Date()
	const [users, projects, weeks] = await Promise.all([
		db.orm.public.User.where(user => user.submissionExtensionUntil.isNotNull())
			.select("displayName", "email", "id", "name", "submissionExtensionUntil")
			.all(),
		db.orm.public.ThemeProject.where({ deletedAt: null })
			.where(project => project.submissionExtensionUntil.isNotNull())
			.select("id", "submissionExtensionUntil", "title")
			.include("user", user => user.select("displayName", "email", "id", "name"))
			.all(),
		db.orm.public.WeekExtension.select("submissionExtensionUntil", "userId", "week")
			.include("user", user => user.select("displayName", "email", "id", "name"))
			.all(),
	])

	const items: DeadlineExtension[] = []
	let expiredHidden = 0
	for (const user of users) {
		const expiresAt = parseNullableTimestamp(user.submissionExtensionUntil)
		if (!expiresAt) continue
		if (expiresAt <= now) {
			expiredHidden += 1
			continue
		}
		items.push({
			email: user.email,
			expiresAt,
			kind: "user",
			projectId: null,
			projectTitle: null,
			userDisplayName: user.displayName,
			userId: user.id,
			userName: user.name,
			week: null,
		})
	}
	for (const project of projects) {
		// The foreign key is required, so a missing owner is a data-integrity error rather than a row to render without one.
		if (!project.user) throw new Error(`project ${project.id} has no owner`)
		const expiresAt = parseNullableTimestamp(project.submissionExtensionUntil)
		if (!expiresAt) continue
		if (expiresAt <= now) {
			expiredHidden += 1
			continue
		}
		items.push({
			email: project.user.email,
			expiresAt,
			kind: "project",
			projectId: project.id,
			projectTitle: project.title,
			userDisplayName: project.user.displayName,
			userId: project.user.id,
			userName: project.user.name,
			week: null,
		})
	}
	for (const extension of weeks) {
		// Week rows cascade off their user, so a missing one is a data-integrity error rather than a row to render without an owner.
		if (!extension.user)
			throw new Error(`week extension for user ${extension.userId} week ${extension.week} has no owner`)
		const expiresAt = parseDbTimestamp(extension.submissionExtensionUntil)
		if (expiresAt <= now) {
			expiredHidden += 1
			continue
		}
		items.push({
			email: extension.user.email,
			expiresAt,
			kind: "week",
			projectId: null,
			projectTitle: null,
			userDisplayName: extension.user.displayName,
			userId: extension.user.id,
			userName: extension.user.name,
			week: extension.week,
		})
	}
	items.sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())

	// The same rule as the user directory: the owner's contact details leave the server for ADMIN/AUDITOR only. A REVIEWER/FULFILLER gets names with no email to scrape.
	const shown = includePii ? items : items.map(item => ({ ...item, email: "" }))
	return {
		expiredHidden,
		items: shown,
		projectActive: items.filter(item => item.kind === "project").length,
		userActive: items.filter(item => item.kind === "user").length,
		weekActive: items.filter(item => item.kind === "week").length,
	}
}
