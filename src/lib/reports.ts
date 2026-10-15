import type { ReportReason, ReportStatus, ReportTarget } from "@/app/generated/prisma/enums"

export type { ReportReason, ReportStatus, ReportTarget }

/**
 * What a report points at. The `id` is the row's own id: a post id for a reel, a comment id for a comment, a project id, a user id, or a work session id for a devlog.
 */
export type ReportTargetInput = {
	type: ReportTarget
	id: string
}

/** The reasons a report can give, in the order the dialog offers them. */
export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
	{ id: "EXCESSIVE_AI_USE", label: "Excessive AI use" },
	{ id: "MISCONDUCT", label: "Misconduct" },
	{ id: "SPAM", label: "Spam" },
	{ id: "OTHER", label: "Other" },
]

export const REPORT_TARGET_LABELS: Record<ReportTarget, string> = {
	DEVLOG: "Devlog",
	PROJECT: "Project",
	REEL: "Reel",
	REEL_COMMENT: "Reel comment",
	USER: "User",
}

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
	DISMISSED: "Dismissed",
	OPEN: "Open",
	RESOLVED: "Resolved",
}
