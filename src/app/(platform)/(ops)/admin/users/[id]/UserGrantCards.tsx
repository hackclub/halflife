import Link from "next/link"
import { Badge, EmptyState, Panel, Table } from "@/app/components/ui"
import { formatUtcDateTime } from "@/lib/deadline"
import { formatUsd } from "@/lib/money"
import { parseDbTimestamp } from "@/lib/time"
import type { UserGrantCards as GrantCards, UserProjectGrantCard, UserShopGrantCard } from "@/lib/user-grant-cards"

const STATUS: { [_: string]: { label: string; tone: "danger" | "muted" | "success" | "warning" } } = {
	AMBIGUOUS: { label: "Check on HCB", tone: "warning" },
	CANCELED: { label: "Cancelled", tone: "muted" },
	FAILED: { label: "Failed", tone: "danger" },
	ISSUED: { label: "Issued", tone: "success" },
	PENDING: { label: "Pending", tone: "muted" },
	RETURNED: { label: "Returned", tone: "muted" },
	SKIPPED: { label: "Skipped", tone: "muted" },
}

const when = (issuedAt: string | null, createdAt: string): string =>
	formatUtcDateTime(parseDbTimestamp(issuedAt ?? createdAt))

function StatusBadge({ status }: Readonly<{ status: string }>) {
	const entry = STATUS[status] ?? { label: status.toLowerCase(), tone: "muted" as const }
	return <Badge tone={entry.tone}>{entry.label}</Badge>
}

/**
 * The Grant cards tab: the account's shop cards, then its project cards. Each row says what became of the card, and links to the order or the project it belongs to.
 */
export function UserGrantCards({ cards, userId }: Readonly<{ cards: GrantCards; userId: string }>) {
	return (
		<>
			<Panel title="Shop grant cards">
				{cards.shop.length === 0 ? (
					<EmptyState>No shop order has asked for a grant card.</EmptyState>
				) : (
					<Table head={["Order", "Item", "Amount", "Status", "When", "Error"]}>
						{cards.shop.map(card => (
							<ShopRow card={card} key={card.id} />
						))}
					</Table>
				)}
			</Panel>

			<Panel title="Project grant cards">
				{cards.project.length === 0 ? (
					<EmptyState>No project has a grant card.</EmptyState>
				) : (
					<Table head={["Project", "Phase", "Amount", "Status", "When", "Error"]}>
						{cards.project.map(card => (
							<ProjectRow card={card} key={card.id} userId={userId} />
						))}
					</Table>
				)}
			</Panel>
		</>
	)
}

function ShopRow({ card }: Readonly<{ card: UserShopGrantCard }>) {
	return (
		<tr>
			<td>
				<Link className="hl-mono" href={`/admin/fulfillment?order=${card.orderId}`}>
					#{card.orderNumber}
				</Link>
			</td>
			<td>{card.itemName}</td>
			<td className="hl-mono">{formatUsd(card.amountCents / 100)}</td>
			<td>
				<StatusBadge status={card.status} />
			</td>
			<td className="hl-mono">{when(card.issuedAt, card.createdAt)}</td>
			<td className="hl-hint">{card.error ?? ""}</td>
		</tr>
	)
}

function ProjectRow({ card, userId }: Readonly<{ card: UserProjectGrantCard; userId: string }>) {
	return (
		<tr>
			<td>
				<Link href={`/admin/users/${userId}?tab=projects#project-${card.projectId}`}>{card.projectTitle}</Link>
			</td>
			<td>{card.phase.toLowerCase()}</td>
			<td className="hl-mono">{formatUsd(card.amountCents / 100)}</td>
			<td>
				<StatusBadge status={card.status} />
				{card.returnedAt ? <div className="hl-hint">Returned {when(card.returnedAt, card.createdAt)}</div> : null}
			</td>
			<td className="hl-mono">{when(card.issuedAt, card.createdAt)}</td>
			<td className="hl-hint">{card.error ?? ""}</td>
		</tr>
	)
}
