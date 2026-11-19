import type { Metadata } from "next"
import Link from "next/link"
import { TabKeys } from "@/app/components/admin/TabKeys"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Badge, EmptyState, PageHeader, Panel } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { displayName } from "@/lib/display-name"
import type { ReportReason, ReportStatus } from "@/lib/enums"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import {
	type ContentReportRow,
	countContentReports,
	listContentReports,
	type ReportStatusFilter,
} from "@/lib/queries/admin"
import { REPORT_REASONS, REPORT_STATUS_LABELS, REPORT_TARGET_LABELS } from "@/lib/reports"
import { firstValues, type SearchParamValue } from "@/lib/search-params"
import { preview } from "@/lib/text"
import { parseDbTimestamp } from "@/lib/time"

export const metadata: Metadata = {
	title: "Reports",
}

export const dynamic = "force-dynamic"

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing the compiler cannot verify without a runtime check
const REASON_LABELS = Object.fromEntries(REPORT_REASONS.map(r => [r.id, r.label])) as { [_ in ReportReason]: string }

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
	searchParams: Promise<{ cursor?: SearchParamValue; id?: SearchParamValue; status?: SearchParamValue }>
}) {
	await requirePermissionPage(Permission.MANAGE_FEED)

	// The filter and the page cursor, each taken as the single value the URL named: a repeated parameter arrives as an array, and an array is not a value this page can read.
	const { id, status, cursor } = firstValues(await searchParams)
	const filter: Filter = filterFor(status)
	const active = FILTERS.find(f => f.id === filter) ?? ({ id: "open", label: "Open", status: "OPEN" } as const)

	const [counts, { items: reports, nextCursor }] = await Promise.all([
		countContentReports(),
		listContentReports(active.status, { cursor }),
	])

	// The report the detail pane shows: the one named in the URL if it is in this queue, otherwise the first one in it.
	const selected = reports.find(report => report.id === id) ?? reports[0] ?? null

	return (
		<section className="hl-stack">
			<PageHeader
				actions={
					<div className="hl-row">
						{FILTERS.map(f => (
							<Link
								aria-current={f.id === filter || undefined}
								className="hl-chip"
								href={f.id === "open" ? "/admin/reports" : `/admin/reports?status=${f.id}`}
								key={f.id}
							>
								{f.label}{" "}
								<span className="hl-count">
									{f.status === "ALL" ? counts.OPEN + counts.RESOLVED + counts.DISMISSED : counts[f.status]}
								</span>
							</Link>
						))}
					</div>
				}
				compact
				title="Reports"
			/>
			<TabKeys
				current={filter === "open" ? "/admin/reports" : `/admin/reports?status=${filter}`}
				hrefs={FILTERS.map(f => (f.id === "open" ? "/admin/reports" : `/admin/reports?status=${f.id}`))}
			/>

			{/* A queue on the left and the chosen report on the right, so a decision is made beside the thing it is about rather than in a row of buttons. */}
			<div className="hl-split">
				<Panel title={`${active.label} reports`}>
					{reports.length === 0 ? (
						<EmptyState>
							{filter === "open"
								? "Nobody has reported anything. The queue is clear."
								: `No ${active.label.toLowerCase()} reports.`}
						</EmptyState>
					) : (
						<nav aria-label="Reports in this queue" className="hl-queue">
							{reports.map(report => {
								const subject = subjectOf(report)
								const params = new URLSearchParams({ id: report.id })
								if (filter !== "open") params.set("status", filter)
								return (
									<Link
										aria-current={report.id === selected?.id ? "true" : undefined}
										className="hl-queue-item"
										href={`/admin/reports?${params.toString()}`}
										key={report.id}
									>
										<Badge tone={reasonTone(report.reason)}>{REASON_LABELS[report.reason]}</Badge>
										<span>{subject.gone ? "Removed" : preview(subject.preview, 70) || "Open"}</span>
										<span className="hl-hint">{formatUtcDateTime(parseDbTimestamp(report.createdAt))}</span>
									</Link>
								)
							})}
						</nav>
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

				{selected ? (
					<Panel title="Report">
						<ReportDetail report={selected} />
					</Panel>
				) : (
					<Panel title="Report">
						<EmptyState>Choose a report from the queue to see what it is about and decide on it.</EmptyState>
					</Panel>
				)}
			</div>
		</section>
	)
}

function filterFor(status: string | undefined): Filter {
	return status === "resolved" || status === "dismissed" || status === "all" ? status : "open"
}

/** The chosen report in full: what it is about, who sent it, when, and the decisions open to staff. */
function ReportDetail({ report }: { report: ContentReportRow }) {
	const subject = subjectOf(report)
	return (
		<div className="hl-stack hl-stack--tight">
			<div>
				<Badge tone="muted">{REPORT_TARGET_LABELS[report.target]}</Badge>{" "}
				<Badge tone={reasonTone(report.reason)}>{REASON_LABELS[report.reason]}</Badge>{" "}
				<Badge tone={statusTone(report.status)}>{REPORT_STATUS_LABELS[report.status]}</Badge>
			</div>
			{subject.gone ? (
				<p className="hl-hint">This {REPORT_TARGET_LABELS[report.target].toLowerCase()} has been removed.</p>
			) : (
				<p className="hl-wrap-anywhere">
					<Link href={subject.href}>{preview(subject.preview, 200) || "Open the reported item"}</Link>
					<span className="hl-hint"> by {subject.author}</span>
				</p>
			)}
			{report.details ? (
				<blockquote className="hl-hint hl-wrap-anywhere" style={{ margin: 0 }}>
					{report.details}
				</blockquote>
			) : null}
			<p className="hl-hint" style={{ margin: 0 }}>
				Reported by {displayName(report.reporter, report.reporter?.email ?? "")} on{" "}
				{formatUtcDateTime(parseDbTimestamp(report.createdAt))}
			</p>
			<ReportActions report={report} subject={subject} />
		</div>
	)
}

function ReportActions({ report, subject }: { report: ContentReportRow; subject: Subject }) {
	return (
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
						tone="danger"
						url={subject.hideUrl}
						variant="default"
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
		author: "-",
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
		const { post } = report
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
		const { comment } = report
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
		const project = session.themeProject
		if (!project) return none
		return {
			author: displayName(project.user) ?? "a maker",
			gone: session.deletedAt !== null,
			hidden: false,
			hideLabel: "Hide",
			hideUrl: null,
			href: `/projects/${project.id}#${session.id}`,
			kind: "entry",
			preview: session.content ?? session.title,
			restoreUrl: null,
		}
	}
	return none
}
