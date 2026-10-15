import Link from "next/link"
import { Badge, EmptyState, PageHeader, Panel, Stat, Table } from "@/app/components/ui"
import { Phase } from "@/app/generated/prisma/enums"
import { requirePermissionPage } from "@/lib/page-guards"
import { Permission } from "@/lib/permissions"
import { getReviewQueue } from "@/lib/queries/review"

export const dynamic = "force-dynamic"

type Props = { searchParams: Promise<{ phase?: string; cursor?: string }> }

export default async function ReviewQueuePage({ searchParams }: Props) {
	const { user } = await requirePermissionPage(Permission.REVIEW_SUBMISSIONS)
	const { phase, cursor } = await searchParams

	const selected = phase === "DESIGN" ? Phase.DESIGN : phase === "BUILD" ? Phase.BUILD : undefined

	const queue = await getReviewQueue({
		reviewerId: user.id,
		phase: selected,
		cursor,
		limit: 50,
	})

	return (
		<div className="hl-stack">
			<PageHeader subtitle="Oldest submissions first." title="Review queue" />

			<div className="hl-row">
				<Stat label="Design waiting" value={queue.counts.design} />
				<Stat label="Build waiting" value={queue.counts.build} />
			</div>

			<div className="hl-row">
				<Link className="hl-btn" href="/review">
					All
				</Link>
				<Link className="hl-btn" href="/review?phase=DESIGN">
					Design
				</Link>
				<Link className="hl-btn" href="/review?phase=BUILD">
					Build
				</Link>
			</div>

			<Panel>
				{queue.items.length === 0 ? (
					<EmptyState>Queue is empty.</EmptyState>
				) : (
					<Table head={["Theme", "Phase", "Participant", "Waiting since", "Claim", ""]}>
						{queue.items.map(item => (
							<tr key={item.id}>
								<td>
									{item.themeLabel}
									<div className="hl-hint">{item.projectTitle}</div>
								</td>
								<td>
									{item.phase.toLowerCase()}
									{/* A warm-up submission was recorded before the season, so
                      its "week" is 0 and saying so would only confuse. */}
									{!item.onTime && item.submittedInWeek !== null && item.submittedInWeek > 0 ? (
										<div className="hl-hint">submitted week {item.submittedInWeek}</div>
									) : null}
								</td>
								<td>{item.participant.name ?? "—"}</td>
								<td className="hl-mono">{item.submittedAt.toDateString()}</td>
								<td>
									{item.claimLive ? (
										<Badge tone="warning">{item.claimedBy?.name ?? "claimed"}</Badge>
									) : (
										<Badge tone="muted">free</Badge>
									)}
								</td>
								<td>
									<Link href={`/review/${item.id}`}>Open</Link>
								</td>
							</tr>
						))}
					</Table>
				)}
				{queue.nextCursor ? (
					<p>
						<Link href={`/review?${selected ? `phase=${selected}&` : ""}cursor=${queue.nextCursor}`}>Next page</Link>
					</p>
				) : null}
			</Panel>
		</div>
	)
}
