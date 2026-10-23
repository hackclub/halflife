import type { ReportReason, ReportStatus, ReportTarget } from "@/app/generated/prisma/enums"

/**
 * What a report points at. The `id` is the row's own id: a post id for a reel, a comment id for a comment, a project id, a user id, or a work session id for a devlog.
 */
interface ReportTargetInput {
	id: string
	type: ReportTarget
}

/** The reasons a report can give, in the order the dialog offers them. */
const REPORT_REASONS: { id: ReportReason; label: string }[] = [
	{ id: "EXCESSIVE_AI_USE", label: "Excessive AI use" },
	{ id: "MISCONDUCT", label: "Misconduct" },
	{ id: "SPAM", label: "Spam" },
	{ id: "OTHER", label: "Other" },
]

const REPORT_TARGET_LABELS: Record<ReportTarget, string> = {
	DEVLOG: "Devlog",
	PROJECT: "Project",
	REEL: "Reel",
	REEL_COMMENT: "Reel comment",
	USER: "User",
}

const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
	DISMISSED: "Dismissed",
	OPEN: "Open",
	RESOLVED: "Resolved",
}

export type { ReportReason, ReportStatus, ReportTarget } from "@/app/generated/prisma/enums"
export { REPORT_REASONS, REPORT_STATUS_LABELS, REPORT_TARGET_LABELS, type ReportTargetInput }
