"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ClaimTimer } from "@/components/review/ClaimTimer"
import { ageTone } from "@/components/review/format"
import { StatusTag, TierTag } from "@/components/review/ui"
import type { ReviewRow } from "@/lib/review-platform/types"

/**
 * The queue's table, as Fabricate draws it.
 *
 * Half Life's counterparts stand in for Fabricate-only columns: the project's theme for its tracking method, and the requested or approved tier for its scraps award. The project links to the staff console's project view rather than a public page, because a Half Life project has no public page of its own.
 */
export function ShipTable({
	rows,
	showMaker = true,
	showProject = true,
}: {
	rows: ReviewRow[]
	showMaker?: boolean
	showProject?: boolean
}) {
	const router = useRouter()
	if (rows.length === 0) return <p className="field__hint">Nothing here.</p>
	return (
		<div className="table-wrap">
			<table className="table">
				<thead>
					<tr>
						<th>Ship</th>
						{showProject ? <th>Project</th> : null}
						{showMaker ? <th>Maker</th> : null}
						<th>Status</th>
						<th className="num">Hours</th>
						<th>Reviewer</th>
						<th>Submitted</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(row => (
						<tr
							className="table__row--link"
							key={row.id}
							onClick={e => {
								if (!(e.target instanceof Element && e.target.closest("a"))) router.push(`/reviews/${row.id}`)
							}}
						>
							<td>
								<Link href={`/reviews/${row.id}`}>
									<StatusTag status={row.kind} /> {row.themeLabel}
								</Link>{" "}
								<TierTag requested={row.tier === null} tier={row.tier ?? row.requestedTier} />
								{row.resubmission ? " ↺" : ""}
								{row.flagged ? (
									<>
										{" "}
										<StatusTag status="flagged" />
									</>
								) : null}
							</td>
							{showProject ? <td>{row.projectName}</td> : null}
							{showMaker ? <td>{row.makerName}</td> : null}
							<td>
								<StatusTag status={row.status} />
								{row.status === "approved" && row.kind === "design" && row.tier !== null ? ` T${row.tier}` : ""}
							</td>
							<td className="num">{row.hoursClaimed}</td>
							<td>
								{row.claimExpiresAt ? (
									<>
										<StatusTag status="claimed" /> {row.reviewerName} · <ClaimTimer expiresAt={row.claimExpiresAt} />
									</>
								) : (
									(row.reviewerName ?? "—")
								)}
							</td>
							<td>
								{row.submittedAt}
								{row.status === "pending" ? (
									<span className={`tone-${ageTone(row.ageDays)}`}> ({row.ageDays}d)</span>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
