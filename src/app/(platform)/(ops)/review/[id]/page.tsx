import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Badge, PageHeader } from "@/app/components/ui"
import { DisputeThread } from "@/components/disputes/DisputeThread"
import { HardLink } from "@/components/site/HardLink"
import { displayName } from "@/lib/display-name"
import { requirePermissionPage } from "@/lib/page-guards"
import { hasPermission, Permission } from "@/lib/permissions"
import { getSubmissionDetail } from "@/lib/queries/review"

export const metadata: Metadata = {
	title: "Dispute",
}

export const dynamic = "force-dynamic"

interface Props {
	params: Promise<{ id: string }>
}

/**
 * The only thing left under /review: answering a maker's dispute. Reviewing a ship happens on /reviews/<id>, which links here when a ship has a dispute open.
 */
export default async function ReviewDisputePage({ params }: Props) {
	const { user, roles } = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)
	const { id } = await params

	const detail = await getSubmissionDetail(id, user.id)
	const dispute = detail?.submission.dispute
	if (!detail || !dispute) notFound()

	const { submission, themeLabel } = detail
	const project = submission.themeProject

	return (
		<div className="hl-stack">
			<PageHeader
				actions={
					<Badge tone={dispute.resolvedAt ? "muted" : "warning"}>{dispute.resolvedAt ? "closed" : "open"}</Badge>
				}
				subtitle={`${project.user.email ? displayName(project.user, project.user.email) : (displayName(project.user) ?? "-")} · ${submission.phase.toLowerCase()}`}
				title={`${themeLabel} · dispute`}
			/>

			<DisputeThread
				closeUrl={`/api/admin/disputes/${dispute.id}/close`}
				dispute={{
					at: dispute.createdAt.getTime(),
					id: dispute.id,
					messages: dispute.messages.map(m => ({
						at: m.createdAt.getTime(),
						body: m.body,
						fromReviewer: m.fromReviewer,
						id: m.id,
						reviewerName: m.author ? displayName(m.author) : null,
					})),
					note: dispute.note,
					outcome: dispute.outcome,
					resolvedAt: dispute.resolvedAt?.getTime() ?? null,
				}}
				replyUrl={`/api/admin/disputes/${dispute.id}/messages`}
				sendBackUrl={
					hasPermission(roles, Permission.OVERRIDE_DECISIONS)
						? `/api/admin/disputes/${dispute.id}/send-back`
						: undefined
				}
				surface="console"
				viewer="reviewer"
			/>

			<p>
				<HardLink href={`/reviews/${id}`}>Open the ship on the review platform</HardLink>
			</p>
		</div>
	)
}
