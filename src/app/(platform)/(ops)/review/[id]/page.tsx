import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { DecisionPanel } from "@/app/components/forms/DecisionPanel"
import { DisputeThread } from "@/app/components/forms/DisputeThread"
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
import { displayName } from "@/lib/display-name"
import { lapseTimelapseUrl } from "@/lib/lapse"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import { getSubmissionDetail } from "@/lib/queries/review"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export default async function ReviewDetailPage({ params }: Props) {
	const { user, roles } = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)
	const { id } = await params

	const detail = await getSubmissionDetail(id, user.id, {
		includeContact: hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR),
		includeRiskFlags:
			hasRole(roles, Role.ADMIN) || hasRole(roles, Role.AUDITOR) || hasPermission(roles, Permission.REVIEW_HOURS),
	})
	if (!detail) notFound()

	const { submission, breakdown, claimLive } = detail
	const project = submission.themeProject
	const claimedByMe = claimLive && submission.claim?.reviewerId === user.id

	return (
		<div className="hl-stack">
			<PageHeader
				actions={
					<Badge tone={statusTone(submission.phase === "DESIGN" ? project.designStatus : project.buildStatus)}>
						{statusLabel(submission.phase === "DESIGN" ? project.designStatus : project.buildStatus)}
					</Badge>
				}
				subtitle={`${project.user.email ? displayName(project.user, project.user.email) : (displayName(project.user) ?? "—")} · submitted ${submission.createdAt.toDateString()}`}
				title={`${detail.themeLabel} – ${submission.phase.toLowerCase()}`}
			/>

			{project.user.fraudFlagged ? (
				<Callout tone="danger">This account is flagged. Do not approve without an admin.</Callout>
			) : null}
			{project.user.verificationStatus !== null && project.user.verificationStatus !== "verified" ? (
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

			{submission.dispute ? (
				<DisputeThread
					closeUrl={`/api/admin/disputes/${submission.dispute.id}/close`}
					dispute={{
						at: submission.dispute.createdAt.getTime(),
						id: submission.dispute.id,
						messages: submission.dispute.messages.map(m => ({
							at: m.createdAt.getTime(),
							body: m.body,
							fromReviewer: m.fromReviewer,
							id: m.id,
						})),
						note: submission.dispute.note,
						outcome: submission.dispute.outcome,
						resolvedAt: submission.dispute.resolvedAt?.getTime() ?? null,
					}}
					replyUrl={`/api/admin/disputes/${submission.dispute.id}/messages`}
					sendBackUrl={
						hasPermission(roles, Permission.OVERRIDE_DECISIONS)
							? `/api/admin/disputes/${submission.dispute.id}/send-back`
							: undefined
					}
					viewer="reviewer"
				/>
			) : null}

			<Panel
				actions={
					claimLive ? (
						<Badge tone="warning">
							{claimedByMe ? "yours" : (displayName(submission.claim?.reviewer) ?? "claimed")} until{" "}
							{submission.claim?.expiresAt.toLocaleTimeString()}
						</Badge>
					) : (
						<Badge tone="muted">unclaimed</Badge>
					)
				}
				title="Claim"
			>
				<div className="hl-row">
					{!claimedByMe ? (
						<ActionButton label="Claim" url={`/api/review/submissions/${id}/claim`} variant="primary" />
					) : (
						<ActionButton label="Release" method="DELETE" url={`/api/review/submissions/${id}/claim`} />
					)}
				</div>
			</Panel>

			<div className="hl-row">
				<Stat label="Journal" value={`${breakdown.journalHours}h`} />
				<Stat label="Hackatime" value={`${breakdown.hackatimeHours}h`} />
				<Stat label="Total" value={`${breakdown.computedTotal}h`} />
				<Stat label="Timelapse coverage" value={`${Math.round(breakdown.timelapseCoverage * 100)}%`} />
			</div>

			{/* A Hackatime total smaller than the one Hackatime reports has to say
			    why, or it reads as a broken number. The overlap is wall-clock time
			    a journal entry with a recording already claimed, so it is counted
			    once, through the entry. */}
			{breakdown.hackatimeOverlapSeconds > 0 && (
				<Callout tone="info">
					<strong>{(breakdown.hackatimeOverlapSeconds / 3600).toFixed(1)}h counted once.</strong> That time is tracked
					by Hackatime <em>and</em> backed by a timelapse on a journal entry, so it is taken off Hackatime and counted
					through the entry. An explicit override bypasses this – the subtraction only applies to computed hours.
				</Callout>
			)}
			{breakdown.hackatimeOverlapUnknown && (
				<Callout tone="warning">
					<strong>Overlap not checked.</strong> The tracked intervals could not be read from Hackatime, so any time
					double-counted between Hackatime and a timelapse is still in the numbers above. Most often this is a
					participant with Hackatime&apos;s public stats turned off.
				</Callout>
			)}

			<Panel title="Project">
				<p style={{ marginTop: 0 }}>
					<strong>{project.title}</strong>
				</p>
				<p className="hl-muted">{project.description ?? "No description."}</p>
				{project.githubRepo ? (
					<p>
						<a href={project.githubRepo} rel="noreferrer" target="_blank">
							{project.githubRepo}
						</a>
					</p>
				) : (
					<p className="hl-hint">No repository linked.</p>
				)}
				{submission.partialFundingAccepted && (
					<Callout tone="info">
						<strong>Partial funding accepted.</strong> Their parts list came to $
						{submission.requestedBomUsd?.toFixed(2) ?? "?"} against a ${submission.fundingCapUsd ?? "?"} tier, so they
						have already agreed to cover the difference themselves. It is not a reason to return it – the box is what
						the submit sheet requires of any over-budget design – but the grant you set decides what they actually get.
					</Callout>
				)}
				{submission.fundingDeclined && (
					<Callout tone="info">
						<strong>Funding declined.</strong> They asked for no parts money on this project, so approving it grants $0
						unless you set an explicit override. Their hours still earn coins as usual – only the grant is off.
					</Callout>
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
						{detail.sessions.map(session => (
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
										<div className="hl-hint">counted via Hackatime – contributes 0 to the journal total</div>
									) : null}
								</td>
								<td className="hl-mono">{session.hoursClaimed}h</td>
								<td>
									<div className="hl-mono">{session.hoursApproved ?? "—"}</div>
									<HoursApprovalForm
										approved={session.hoursApproved}
										claimed={claimedByMe}
										id={session.id}
										kind="session"
									/>
								</td>
								<td>
									{session.media.map(m => (
										<a href={m.url ?? "#"} key={m.id} style={{ marginRight: "0.5rem" }}>
											{m.type.toLowerCase()}
										</a>
									))}
									{session.timelapses.map(t => (
										<a
											href={
												t.provider === "lapse" && t.externalId
													? lapseTimelapseUrl(t.externalId)
													: (t.playbackUrl ?? "#")
											}
											key={t.id}
											rel="noreferrer"
											style={{ marginRight: "0.5rem" }}
											target="_blank"
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
						{detail.links.map(link => (
							<tr key={link.id}>
								<td className="hl-mono">{link.hackatimeProject}</td>
								<td>
									<div>{(link.hoursApproved ?? (link.cachedSeconds ?? 0) / 3600).toFixed(1)}h</div>
									<HoursApprovalForm
										approved={link.hoursApproved}
										claimed={claimedByMe}
										id={link.id}
										kind="hackatime"
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
						{detail.priorReviews.map(review => (
							<tr key={review.id}>
								<td className="hl-mono">{review.createdAt.toDateString()}</td>
								<td>{review.submission.phase.toLowerCase()}</td>
								<td>
									{review.result.toLowerCase()}
									{review.invalidated ? <div className="hl-hint">invalidated</div> : null}
								</td>
								<td>{displayName(review.reviewer) ?? "Ari"}</td>
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

			{submission.resolvedAt ? (
				<Callout>
					This hand-in has already been decided, so there is nothing left to decide here. Undoing a decision is the
					override path.
				</Callout>
			) : (
				<Panel title="Decision">
					<DecisionPanel
						claimedByMe={claimedByMe}
						computedHours={breakdown.computedTotal}
						currentTier={project.tier}
						phase={submission.phase}
						submissionId={id}
						tiers={TIERS.map(t => ({
							fundingHours: t.fundingHours,
							grantUsd: t.grantUsd,
							id: t.id,
							name: t.name,
							submitFloorHours: submitFloorFor(t.fundingHours),
						}))}
					/>
				</Panel>
			)}

			<p>
				<Link href="/review">Back to the queue</Link>
			</p>
		</div>
	)
}
