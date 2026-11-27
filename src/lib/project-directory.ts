import "server-only"
import type { ProjectRowData } from "@/app/(platform)/(ops)/admin/projects/ProjectRow"
import type { ProjectManageFlags } from "@/app/components/admin/ProjectManagePanel"
import { themeLabel } from "@/lib/config/program"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import { PhaseStatus, Theme } from "@/lib/enums"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import { statusFor } from "@/lib/phase"
import { isPhaseDecided } from "@/lib/program"
import type { ProjectDirectoryRow, ProjectFilters } from "@/lib/queries/admin"

/** How many projects one page of the admin list holds. */
export const PROJECT_PAGE_SIZE = 50

/** The filter parameters the projects list reads, each as the single string the URL named. */
export interface ProjectSearch {
	build?: string
	design?: string
	extended?: string
	q?: string
	theme?: string
	tier?: string
	unstarted?: string
}

const STATUSES = Object.values(PhaseStatus)

const status = (v?: string) => STATUSES.find(x => x === v)

/** Anything unrecognised in the query string is dropped, not trusted. */
export function projectFiltersFrom(s: ProjectSearch): ProjectFilters {
	const tier = Number(s.tier)
	return {
		buildStatus: status(s.build),
		designStatus: status(s.design),
		extended: s.extended === "1",
		q: s.q?.trim() || undefined,
		theme: Object.values(Theme).find(t => t === s.theme),
		tier: tier === 1 || tier === 2 || tier === 3 ? tier : undefined,
		unstarted: s.unstarted === "1",
	}
}

/**
 * Which controls a viewer may use on the list, and whether they may see contact details. The server checks every action again; these only decide what is offered.
 */
export function projectAccessFor(roles: Role[]): { flags: ProjectManageFlags; includePii: boolean } {
	const canExtend = hasPermission(roles, Permission.MANAGE_USERS)
	const canMoveTheme = hasPermission(roles, Permission.MANAGE_PROGRAM)
	const canOverride = hasPermission(roles, Permission.OVERRIDE_DECISIONS)
	// The same controls as a user's themed projects. Sending a grant needs the owner's identity checked, which this list does not look up row by row, so it stays on the user page.
	const flags = {
		canEditHours: canOverride,
		canExtend,
		canMoveTheme,
		canOverride,
		canSendGrant: false,
		canSyncBom: canMoveTheme,
	}
	// The owner's email and Slack ID are contact details: they leave the server for ADMIN/AUDITOR only, exactly as the user directory does.
	const includePii = hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR)
	return { flags, includePii }
}

/** One project as the list draws it. Everything is worked out on the server, so the payload is plain JSON. */
export function toProjectRow(project: ProjectDirectoryRow, now: Date): ProjectRowData {
	const userExtension =
		project.user.submissionExtensionUntil && project.user.submissionExtensionUntil > now
			? formatUtcDateTime(project.user.submissionExtensionUntil)
			: null
	return {
		buildStatus: project.buildStatus,
		designStatus: project.designStatus,
		disputes: project.disputes.map(item => ({
			dispute: {
				at: item.createdAt.getTime(),
				id: item.id,
				messages: item.messages.map(message => ({
					at: message.createdAt.getTime(),
					body: message.body,
					fromReviewer: message.fromReviewer,
					id: message.id,
					reviewerName: message.author ? displayName(message.author) : null,
				})),
				note: item.note,
				outcome: item.outcome,
				resolvedAt: item.resolvedAt?.getTime() ?? null,
			},
			phase: item.phase,
		})),
		extension: project.submissionExtensionUntil?.toISOString() ?? null,
		extensionLabel: project.submissionExtensionUntil ? formatUtcDateTime(project.submissionExtensionUntil) : null,
		githubRepo: project.githubRepo,
		grantSent: project.grantSent,
		grantUsd: project.designStatus === PhaseStatus.approved ? project.grantUsd : null,
		id: project.id,
		journal: project.workSessions.map(session => {
			const phaseStatus = statusFor(project, session.phase)
			return {
				decided: isPhaseDecided(phaseStatus),
				effectiveDate: session.effectiveDate,
				hoursApproved: session.hoursApproved,
				hoursClaimed: session.hoursClaimed,
				id: session.id,
				locked: phaseStatus === PhaseStatus.in_review,
				phase: session.phase,
				title: session.title,
			}
		}),
		ownerId: project.user.id,
		ownerName: displayName(project.user) ?? "-",
		requestedTier: project.requestedTier,
		starterProjectId: project.starterProjectId,
		theme: project.theme,
		themeLabel: themeLabel(project.theme),
		tier: project.tier,
		title: project.title,
		userExtension,
	}
}
