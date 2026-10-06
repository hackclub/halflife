import Link from "next/link"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Badge, EmptyState, Panel, Table } from "@/app/components/ui"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	countContentReports,
	listContentReports,
	type ContentReportRow,
	type ReportStatusFilter,
} from "@/lib/queries/admin"
import { REPORT_STATUS_LABELS, REPORT_TARGET_LABELS, REPORT_REASONS } from "@/lib/reports"
import type { ReportReason, ReportStatus } from "@/app/generated/prisma/enums"

export const dynamic = "force-dynamic"

const whenFormat = new Intl.DateTimeFormat("en-US", {
	timeZone: "UTC",
	dateStyle: "medium",
	timeStyle: "short",
})

function preview(text: string, max = 90): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label])) as Record<ReportReason, string>

function reasonTone(reason: ReportReason): "success" | "warning" | "danger" | "muted" {
	return reason === "MISCONDUCT" ? "danger" : reason === "SPAM" ? "warning" : "muted"
}

function statusTone(status: ReportStatus): "success" | "warning" | "danger" | "muted" {
	return status === "OPEN" ? "warning" : status === "RESOLVED" ? "success" : "muted"
}

type Filter = "open" | "resolved" | "dismissed" | "all"

const FILTERS: { id: Filter; label: string; status: ReportStatusFilter }[] = [
	{ id: "open", label: "Open", status: "OPEN" },
	{ id: "resolved", label: "Resolved", status: "RESOLVED" },
	{ id: "dismissed", label: "Dismissed", status: "DISMISSED" },
	{ id: "all", label: "All", status: "ALL" },
]

/**
 * Where user reports land. A report changes nothing by itself — it puts a
 * reel, comment, project, user or devlog in front of staff. Deciding one
 * closes it as resolved or dismissed; taking the thing down stays the
 * existing hide action next to it, so a report is never a silent takedown.
 */
export default async function AdminReportsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string }>
}) {
	await requirePermissionPage(Permission.MANAGE_FEED)

	const { status } = await searchParams
	const filter: Filter = filterFor(status)
	const active = FILTERS.find((f) => f.id === filter) ?? { id: "open", label: "Open", status: "OPEN" } as const

	const [counts, reports] = await Promise.all([countContentReports(), listContentReports(active.status)])

	return (
		<section className="hl-stack">
			<div className="hl-row" style={{ justifyContent: "space-between" }}>
				<h1 style={{ margin: 0 }}>Reports</h1>
				<div className="hl-row">
					{FILTERS.map((f) => (
						<Link
							key={f.id}
							href={f.id === "open" ? "/admin/reports" : `/admin/reports?status=${f.id}`}
							aria-current={f.id === filter || undefined}
							className="hl-hint"
							style={f.id === filter ? { color: "var(--color-ink-strong)", fontWeight: 700 } : undefined}
						>
							{f.label} ({f.status === "ALL" ? counts.OPEN + counts.RESOLVED + counts.DISMISSED : counts[f.status]})
						</Link>
					))}
				</div>
			</div>

			<Panel title={`${active.label} reports`}>
				{reports.length === 0 ? (
					<EmptyState>
						{filter === "open" ? "Nobody has reported anything. The queue is clear." : `No ${active.label.toLowerCase()} reports.`}
					</EmptyState>
				) : (
					<Table head={["Reported", "Reason", "Reporter", "Received", "Status", ""]}>
						{reports.map((report) => (
							<ReportRow key={report.id} report={report} />
						))}
					</Table>
				)}
			</Panel>
		</section>
	)
}

function filterFor(status: string | undefined): Filter {
	return status === "resolved" || status === "dismissed" || status === "all" ? status : "open"
}

function ReportRow({ report }: { report: ContentReportRow }) {
	const subject = subjectOf(report)
	return (
		<tr>
			<td>
				<Badge tone="muted">{REPORT_TARGET_LABELS[report.target]}</Badge>{" "}
				{subject.gone ? (
					<Badge tone="danger">removed</Badge>
				) : (
					<Link href={subject.href}>{preview(subject.preview, 80) || "open"}</Link>
				)}
				<div className="hl-hint">
					by {subject.author}
					{report.details ? ` — “${preview(report.details, 80)}”` : ""}
				</div>
			</td>
			<td>
				<Badge tone={reasonTone(report.reason)}>{REASON_LABELS[report.reason]}</Badge>
			</td>
			<td className="hl-hint">{displayName(report.reporter, report.reporter.email)}</td>
			<td className="hl-mono">{whenFormat.format(report.createdAt)}</td>
			<td>
				<Badge tone={statusTone(report.status)}>{REPORT_STATUS_LABELS[report.status]}</Badge>
				{report.status !== "OPEN" && report.resolvedAt ? (
					<div className="hl-hint">{whenFormat.format(report.resolvedAt)}</div>
				) : null}
			</td>
			<td>
				<div className="hl-row">
					{!subject.gone &&
						subject.hideUrl &&
						(subject.hidden ? (
							subject.restoreUrl ? (
								<ActionButton
									url={subject.restoreUrl}
									method="DELETE"
									label="Restore"
									confirm="Put this reel back in the feed?"
								/>
							) : (
								<span className="hl-hint">hidden</span>
							)
						) : (
							<ActionButton
								url={subject.hideUrl}
								label={subject.hideLabel}
								variant="danger"
								confirm={`${subject.hideLabel} this ${subject.kind}?`}
								reasonPrompt={`Why is this ${subject.kind} being hidden?`}
							/>
						))}
					{report.status === "OPEN" && (
						<>
							<ActionButton
								url={`/api/admin/reports/${report.id}/resolve`}
								label="Resolve"
								confirm="Close this report as reviewed?"
							/>
							<ActionButton
								url={`/api/admin/reports/${report.id}/dismiss`}
								label="Dismiss"
								confirm="Close this report as no violation?"
							/>
						</>
					)}
				</div>
			</td>
		</tr>
	)
}

interface Subject {
	preview: string
	href: string
	author: string
	gone: boolean
	kind: string
	hidden: boolean
	hideUrl: string | null
	hideLabel: string
	restoreUrl: string | null
}

function subjectOf(report: ContentReportRow): Subject {
	const none: Subject = {
		preview: "",
		href: "#",
		author: "—",
		gone: true,
		kind: "",
		hidden: false,
		hideUrl: null,
		hideLabel: "Hide",
		restoreUrl: null,
	}
	if (report.target === "REEL" && report.post) {
		const post = report.post
		return {
			preview: post.caption,
			href: `/doomscroller?reel=${post.id}`,
			author: displayName(post.user) ?? "a maker",
			gone: post.deletedAt !== null,
			kind: "reel",
			hidden: post.hiddenAt !== null,
			hideUrl: post.hiddenAt ? null : `/api/admin/posts/${post.id}/moderate`,
			hideLabel: "Hide",
			restoreUrl: post.hiddenAt ? `/api/admin/posts/${post.id}/moderate` : null,
		}
	}
	if (report.target === "REEL_COMMENT" && report.comment) {
		const comment = report.comment
		return {
			preview: comment.body,
			href: `/doomscroller?reel=${comment.postId}&comments=1`,
			author: displayName(comment.user) ?? "a maker",
			gone: comment.deletedAt !== null,
			kind: "comment",
			hidden: comment.hiddenAt !== null,
			hideUrl: comment.hiddenAt ? null : `/api/admin/comments/${comment.id}/moderate`,
			hideLabel: "Hide",
			restoreUrl: null,
		}
	}
	if (report.target === "PROJECT" && report.themeProject) {
		const project = report.themeProject
		return {
			preview: project.title || "untitled project",
			href: `/projects/${project.id}`,
			author: displayName(project.user) ?? "a maker",
			gone: project.deletedAt !== null,
			kind: "project",
			hidden: false,
			hideUrl: null,
			hideLabel: "Hide",
			restoreUrl: null,
		}
	}
	if (report.target === "USER" && report.targetUser) {
		const user = report.targetUser
		return {
			preview: displayName(user) ?? "a maker",
			href: `/admin/users/${user.id}`,
			author: displayName(user) ?? "a maker",
			gone: false,
			kind: "user",
			hidden: false,
			hideUrl: null,
			hideLabel: "Hide",
			restoreUrl: null,
		}
	}
	if (report.target === "DEVLOG" && report.workSession) {
		const session = report.workSession
		return {
			preview: session.content ?? session.title,
			href: `/projects/${session.themeProject.id}#${session.id}`,
			author: displayName(session.themeProject.user) ?? "a maker",
			gone: session.deletedAt !== null,
			kind: "entry",
			hidden: false,
			hideUrl: null,
			hideLabel: "Hide",
			restoreUrl: null,
		}
	}
	return none
}
