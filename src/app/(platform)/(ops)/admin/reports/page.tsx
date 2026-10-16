import Link from "next/link"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Badge, EmptyState, Panel, Table } from "@/app/components/ui"
import type { ReportReason, ReportStatus } from "@/app/generated/prisma/enums"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	type ContentReportRow,
	countContentReports,
	listContentReports,
	type ReportStatusFilter,
} from "@/lib/queries/admin"
import { REPORT_REASONS, REPORT_STATUS_LABELS, REPORT_TARGET_LABELS } from "@/lib/reports"

export const dynamic = "force-dynamic"

const whenFormat = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "UTC",
})

function preview(text: string, max = 90): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map(r => [r.id, r.label])) as Record<ReportReason, string>

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
 * Where user reports land. A report changes nothing by itself – it puts a reel, comment, project, user or devlog in front of staff. Deciding one closes it as resolved or dismissed; taking the thing down stays the existing hide action next to it, so a report is never a silent takedown.
 */
export default async function AdminReportsPage({
	searchParams,
}: {
	searchParams: Promise<{ status?: string; cursor?: string }>
}) {
	await requirePermissionPage(Permission.MANAGE_FEED)

	const { status, cursor } = await searchParams
	const filter: Filter = filterFor(status)
	const active = FILTERS.find(f => f.id === filter) ?? ({ id: "open", label: "Open", status: "OPEN" } as const)

	const [counts, { items: reports, nextCursor }] = await Promise.all([
		countContentReports(),
		listContentReports(active.status, { cursor }),
	])

	return (
		<section className="hl-stack">
			<div className="hl-row" style={{ justifyContent: "space-between" }}>
				<h1 style={{ margin: 0 }}>Reports</h1>
				<div className="hl-row">
					{FILTERS.map(f => (
						<Link
							aria-current={f.id === filter || undefined}
							className="hl-hint"
							href={f.id === "open" ? "/admin/reports" : `/admin/reports?status=${f.id}`}
							key={f.id}
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
						{filter === "open"
							? "Nobody has reported anything. The queue is clear."
							: `No ${active.label.toLowerCase()} reports.`}
					</EmptyState>
				) : (
					<Table head={["Reported", "Reason", "Reporter", "Received", "Status", ""]}>
						{reports.map(report => (
							<ReportRow key={report.id} report={report} />
						))}
					</Table>
				)}
				{nextCursor ? (
					<p>
						<Link
							href={
								filter === "open"
									? `/admin/reports?cursor=${nextCursor}`
									: `/admin/reports?status=${filter}&cursor=${nextCursor}`
							}
						>
							Next page
						</Link>
					</p>
				) : null}
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
					{report.details ? ` – “${preview(report.details, 80)}”` : ""}
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
					{!subject.gone
						&& (subject.hideUrl || subject.restoreUrl || subject.hidden)
						&& (subject.hidden ? (
							subject.restoreUrl ? (
								<ActionButton
									confirm="Put this reel back in the feed?"
									label="Restore"
									method="DELETE"
									url={subject.restoreUrl}
								/>
							) : (
								<span className="hl-hint">hidden</span>
							)
						) : subject.hideUrl ? (
							<ActionButton
								confirm={`${subject.hideLabel} this ${subject.kind}?`}
								label={subject.hideLabel}
								reasonPrompt={`Why is this ${subject.kind} being hidden?`}
								url={subject.hideUrl}
								variant="danger"
							/>
						) : null)}
					{report.status === "OPEN" && (
						<>
							<ActionButton
								confirm="Close this report as reviewed?"
								label="Resolve"
								url={`/api/admin/reports/${report.id}/resolve`}
							/>
							<ActionButton
								confirm="Close this report as no violation?"
								label="Dismiss"
								url={`/api/admin/reports/${report.id}/dismiss`}
							/>
						</>
					)}
				</div>
			</td>
		</tr>
	)
}

interface Subject {
	author: string
	gone: boolean
	hidden: boolean
	hideLabel: string
	hideUrl: string | null
	href: string
	kind: string
	preview: string
	restoreUrl: string | null
}

function subjectOf(report: ContentReportRow): Subject {
	const none: Subject = {
		author: "—",
		gone: true,
		hidden: false,
		hideLabel: "Hide",
		hideUrl: null,
		href: "#",
		kind: "",
		preview: "",
		restoreUrl: null,
	}
	if (report.target === "REEL" && report.post) {
		const post = report.post
		return {
			author: displayName(post.user) ?? "a maker",
			gone: post.deletedAt !== null,
			hidden: post.hiddenAt !== null,
			hideLabel: "Hide",
			hideUrl: post.hiddenAt ? null : `/api/admin/posts/${post.id}/moderate`,
			href: `/doomscroller?reel=${post.id}`,
			kind: "reel",
			preview: post.caption,
			restoreUrl: post.hiddenAt ? `/api/admin/posts/${post.id}/moderate` : null,
		}
	}
	if (report.target === "REEL_COMMENT" && report.comment) {
		const comment = report.comment
		return {
			author: displayName(comment.user) ?? "a maker",
			gone: comment.deletedAt !== null,
			hidden: comment.hiddenAt !== null,
			hideLabel: "Hide",
			hideUrl: comment.hiddenAt ? null : `/api/admin/comments/${comment.id}/moderate`,
			href: `/doomscroller?reel=${comment.postId}&comments=1`,
			kind: "comment",
			preview: comment.body,
			restoreUrl: null,
		}
	}
	if (report.target === "PROJECT" && report.themeProject) {
		const project = report.themeProject
		return {
			author: displayName(project.user) ?? "a maker",
			gone: project.deletedAt !== null,
			hidden: false,
			hideLabel: "Hide",
			hideUrl: null,
			href: `/projects/${project.id}`,
			kind: "project",
			preview: project.title || "untitled project",
			restoreUrl: null,
		}
	}
	if (report.target === "USER" && report.targetUser) {
		const user = report.targetUser
		return {
			author: displayName(user) ?? "a maker",
			gone: false,
			hidden: false,
			hideLabel: "Hide",
			hideUrl: null,
			href: `/admin/users/${user.id}`,
			kind: "user",
			preview: displayName(user) ?? "a maker",
			restoreUrl: null,
		}
	}
	if (report.target === "DEVLOG" && report.workSession) {
		const session = report.workSession
		return {
			author: displayName(session.themeProject.user) ?? "a maker",
			gone: session.deletedAt !== null,
			hidden: false,
			hideLabel: "Hide",
			hideUrl: null,
			href: `/projects/${session.themeProject.id}#${session.id}`,
			kind: "entry",
			preview: session.content ?? session.title,
			restoreUrl: null,
		}
	}
	return none
}
