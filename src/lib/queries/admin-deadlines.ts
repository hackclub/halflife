import "server-only"
import db from "@/lib/prisma8"
import { parseDbTimestamp, parseNullableTimestamp } from "@/lib/time"

/** Where an extension hangs: the whole account, one program week, or one project. */
export type ExtensionKind = "user" | "week" | "project"

/** One extension, live or expired, whoever holds it and whatever it covers. */
export interface DeadlineExtension {
	email: string
	expired: boolean
	expiresAt: Date
	kind: ExtensionKind
	projectId: string | null
	projectTitle: string | null
	userDisplayName: string | null
	userId: string
	userName: string | null
	week: number | null
}

/** Every extension on record, split into the live and expired counts the tabs show. */
export interface DeadlineSummary {
	active: number
	activeProject: number
	activeUser: number
	activeWeek: number
	expired: number
	items: DeadlineExtension[]
}

/**
 * Every extension on record, from all three places one can hang.
 *
 * A user extension covers every project its owner holds, so passed weeks take journal entries again and work can be submitted past a global close. A week extension stays on the week and covers its project once one exists, including weeks with no project row yet. A project extension covers that project only. Live rows come first, soonest to run out first; expired rows follow, most recently expired first. The counts are per kind for live rows and in total for expired ones, so the tabs and stats can be read without a second pass.
 */
export async function listExtensions(flags?: { includePii?: boolean }): Promise<DeadlineSummary> {
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
	for (const user of users) {
		const expiresAt = parseNullableTimestamp(user.submissionExtensionUntil)
		if (!expiresAt) continue
		items.push({
			email: user.email,
			expired: expiresAt <= now,
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
		items.push({
			email: project.user.email,
			expired: expiresAt <= now,
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
		items.push({
			email: extension.user.email,
			expired: expiresAt <= now,
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

	const live = items.filter(item => !item.expired).toSorted((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime())
	const lapsed = items.filter(item => item.expired).toSorted((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())

	// The same rule as the user directory: the owner's contact details leave the server for ADMIN/AUDITOR only. A REVIEWER/FULFILLER gets names with no email to scrape.
	const sorted = [...live, ...lapsed]
	const shown = includePii ? sorted : sorted.map(item => ({ ...item, email: "" }))
	return {
		active: live.length,
		activeProject: live.filter(item => item.kind === "project").length,
		activeUser: live.filter(item => item.kind === "user").length,
		activeWeek: live.filter(item => item.kind === "week").length,
		expired: lapsed.length,
		items: shown,
	}
}
