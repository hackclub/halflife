import Link from "next/link"
import { notFound } from "next/navigation"
import { ActionButton } from "@/app/components/forms/ActionButton"
import { Badge, Callout, PageHeader, Panel, statusLabel, statusTone } from "@/app/components/ui"
import { DisputeThread } from "@/components/disputes/DisputeThread"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, hasRole, Permission, Role } from "@/lib/permissions"
import { getSubmissionDetail } from "@/lib/queries/review"
import { ReviewBom, ReviewDecision, ReviewEvidence, ReviewHours, ReviewProject } from "./ReviewPanels"

export const dynamic = "force-dynamic"

interface Props {
	params: Promise<{ id: string }>
}

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
				subtitle={`${project.user.email ? displayName(project.user, project.user.email) : (displayName(project.user) ?? "-")} · submitted ${submission.createdAt.toDateString()}`}
				title={`${detail.themeLabel} · ${submission.phase.toLowerCase()}`}
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
					surface="console"
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

			<ReviewHours breakdown={breakdown} />
			<ReviewProject detail={detail} />
			<ReviewBom detail={detail} />
			<ReviewEvidence claimedByMe={claimedByMe} detail={detail} />
			<ReviewDecision claimedByMe={claimedByMe} detail={detail} submissionId={id} />

			<p>
				<Link href="/review">Back to the queue</Link>
			</p>
		</div>
	)
}
