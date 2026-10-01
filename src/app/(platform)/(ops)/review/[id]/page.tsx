import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { DecisionPanel } from "@/app/components/forms/DecisionPanel"
import { HoursApprovalForm } from "@/app/components/forms/HoursApprovalForm"
import {
	Badge,
	Callout,
	EmptyState,
	PageHeader,
	Panel,
	Stat,
	statusLabel,
	statusTone,
	Table,
} from "@/app/components/ui"
import { submitFloorFor } from "@/lib/config/printers"
import { TIERS } from "@/lib/config/tiers"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getSubmissionDetail } from "@/lib/queries/review"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export default async function ReviewDetailPage({ params }: Props) {
	const { user } = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)
	const { id } = await params

	const detail = await getSubmissionDetail(id, user.id)
	if (!detail) notFound()

	const { submission, breakdown, claimLive } = detail
	const project = submission.themeProject
	const claimedByMe = claimLive && submission.claim?.reviewerId === user.id

	return (
		<div className="hl-stack">
			<PageHeader
				title={`${detail.themeLabel} — ${submission.phase.toLowerCase()}`}
				subtitle={`${project.user.name ?? project.user.email} · submitted ${submission.createdAt.toDateString()}`}
				actions={
					<Badge tone={statusTone(submission.phase === "DESIGN" ? project.designStatus : project.buildStatus)}>
						{statusLabel(submission.phase === "DESIGN" ? project.designStatus : project.buildStatus)}
					</Badge>
				}
			/>

			{project.user.fraudFlagged ? (
				<Callout tone="danger">This account is flagged. Do not approve without an admin.</Callout>
			) : null}
			{project.user.verificationStatus !== "verified" ? (
				<Callout tone="warning">
					Identity status is “{project.user.verificationStatus ?? "unknown"}”, not verified.
				</Callout>
			) : null}
			{breakdown.hackatimeStale ? (
				<Callout tone="warning">
					Hackatime hours could not be refreshed and may be stale. Approving will be refused until they resolve, or set
					an explicit hours override.
				</Callout>
			) : null}

			{submission.dispute && !submission.dispute.resolvedAt ? (
				<Callout tone="warning">
					<strong>The maker disputes this decision.</strong> {submission.dispute.note}
					<div style={{ marginTop: "0.5rem" }}>
						<ActionButton
							url={`/api/admin/disputes/${submission.dispute.id}/resolve`}
							body={{}}
							label="Mark as looked at"
							confirm="Close this dispute? The decision itself does not change."
						/>
					</div>
				</Callout>
			) : null}
			{submission.dispute?.resolvedAt ? (
				<Callout>
					The maker disputed this decision; a reviewer marked it looked at{" "}
					{submission.dispute.resolvedAt.toDateString()}.
				</Callout>
			) : null}

			<Panel
				title="Claim"
				actions={
					claimLive ? (
						<Badge tone="warning">
							{claimedByMe ? "yours" : (submission.claim?.reviewer.name ?? "claimed")} until{" "}
							{submission.claim?.expiresAt.toLocaleTimeString()}
						</Badge>
					) : (
						<Badge tone="muted">unclaimed</Badge>
					)
				}
			>
				<div className="hl-row">
					{!claimedByMe ? (
						<ActionButton url={`/api/review/submissions/${id}/claim`} label="Claim" variant="primary" />
					) : (
						<ActionButton url={`/api/review/submissions/${id}/claim`} method="DELETE" label="Release" />
					)}
				</div>
			</Panel>

			<div className="hl-row">
				<Stat label="Journal" value={`${breakdown.journalHours}h`} />
				<Stat label="Hackatime" value={`${breakdown.hackatimeHours}h`} />
				<Stat label="Total" value={`${breakdown.computedTotal}h`} />
				<Stat label="Timelapse coverage" value={`${Math.round(breakdown.timelapseCoverage * 100)}%`} />
			</div>

			<Panel title="Project">
				<p style={{ marginTop: 0 }}>
					<strong>{project.title}</strong>
				</p>
				<p className="hl-muted">{project.description ?? "No description."}</p>
				{project.githubRepo ? (
					<p>
						<a href={project.githubRepo} target="_blank" rel="noreferrer">
							{project.githubRepo}
						</a>
					</p>
				) : (
					<p className="hl-hint">No repository linked.</p>
				)}
				{submission.notes ? (
					<Callout>
						<strong>Submission note:</strong> {submission.notes}
					</Callout>
				) : null}
			</Panel>

			<Panel title="Work log">
				{detail.sessions.length === 0 ? (
					<EmptyState>No sessions logged for this phase.</EmptyState>
				) : (
					<Table head={["Date", "What", "Claimed", "Approved", "Evidence"]}>
						{detail.sessions.map((session) => (
							<tr key={session.id}>
								<td className="hl-mono">{session.effectiveDate ?? "—"}</td>
								<td>
									{session.title}
									{session.content ? (
										<div className="hl-hint" style={{ whiteSpace: "pre-wrap" }}>
											{session.content.slice(0, 600)}
										</div>
									) : null}
									{session.hoursSource === "HACKATIME_TRACKED" ? (
										<div className="hl-hint">counted via Hackatime — contributes 0 to the journal total</div>
									) : null}
								</td>
								<td className="hl-mono">{session.hoursClaimed}h</td>
								<td>
									<div className="hl-mono">{session.hoursApproved ?? "—"}</div>
									<HoursApprovalForm
										kind="session"
										id={session.id}
										claimed={claimedByMe}
										approved={session.hoursApproved}
									/>
								</td>
								<td>
									{session.media.map((m) => (
										<a key={m.id} href={m.url ?? "#"} style={{ marginRight: "0.5rem" }}>
											{m.type.toLowerCase()}
										</a>
									))}
									{session.timelapses.map((t) => (
										<a
											key={t.id}
											href={
												t.provider === "lapse" && t.externalId
													? lapseTimelapseUrl(t.externalId)
													: (t.playbackUrl ?? "#")
											}
											target="_blank"
											rel="noreferrer"
											style={{ marginRight: "0.5rem" }}
										>
											{t.provider === "lapse" ? "lapse" : "timelapse"}
											{t.coveredSeconds ? ` (${Math.round(t.coveredSeconds / 60)}m)` : ""}
										</a>
									))}
								</td>
							</tr>
						))}
					</Table>
				)}
			</Panel>

			{detail.links.length > 0 ? (
				<Panel title="Hackatime links">
					<Table head={["Project", "Hours", "Cached", "Error"]}>
						{detail.links.map((link) => (
							<tr key={link.id}>
								<td className="hl-mono">{link.hackatimeProject}</td>
								<td>
									<div>{(link.hoursApproved ?? (link.cachedSeconds ?? 0) / 3600).toFixed(1)}h</div>
									<HoursApprovalForm
										kind="hackatime"
										id={link.id}
										claimed={claimedByMe}
										approved={link.hoursApproved}
									/>
								</td>
								<td className="hl-mono">{link.cachedAt?.toLocaleString() ?? "never"}</td>
								<td className="hl-hint">{link.lastFetchError ?? ""}</td>
							</tr>
						))}
					</Table>
				</Panel>
			) : null}

			{detail.priorReviews.length > 0 ? (
				<Panel title="Earlier decisions on this project">
					<Table head={["When", "Phase", "Result", "Reviewer", "Feedback"]}>
						{detail.priorReviews.map((review) => (
							<tr key={review.id}>
								<td className="hl-mono">{review.createdAt.toDateString()}</td>
								<td>{review.submission.phase.toLowerCase()}</td>
								<td>
									{review.result.toLowerCase()}
									{review.invalidated ? <div className="hl-hint">invalidated</div> : null}
								</td>
								<td>{review.reviewer?.name ?? "Ari"}</td>
								<td>
									{review.feedback}
									{review.frozenApprovedHours !== null ? (
										<div className="hl-hint">
											{review.frozenApprovedHours}h at tier {review.frozenTier ?? "—"}
											{review.frozenGrantUsd !== null ? ` · $${review.frozenGrantUsd}` : ""}
										</div>
									) : null}
								</td>
							</tr>
						))}
					</Table>
				</Panel>
			) : null}

			<Panel title="Decision">
				<DecisionPanel
					submissionId={id}
					phase={submission.phase}
					tiers={TIERS.map((t) => ({
						id: t.id,
						name: t.name,
						grantUsd: t.grantUsd,
						fundingHours: t.fundingHours,
						submitFloorHours: submitFloorFor(t.fundingHours),
					}))}
					currentTier={project.tier}
					computedHours={breakdown.computedTotal}
					claimedByMe={claimedByMe}
				/>
			</Panel>

			<p>
				<Link href="/review">Back to the queue</Link>
			</p>
		</div>
	)
}
