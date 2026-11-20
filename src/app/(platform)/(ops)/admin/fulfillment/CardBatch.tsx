"use client"

import Link from "next/link"
import { useState } from "react"
import { z } from "zod"
import { Button, Callout, EmptyState, Field, Panel, Table, TextArea } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { formatUtcDateTime } from "@/lib/deadline"
import { formatUsd } from "@/lib/money"
import type { BatchBlockedOrder, BatchGroup, BatchSendOutcome } from "@/lib/shop-grant-card-batch"
import { sendJsonParsed, useAction } from "@/lib/use-action"

const outcomeSchema = z.object({
	error: z.string().nullable(),
	orderId: z.string(),
	orderNumber: z.number(),
	sent: z.boolean(),
})

const sendResultSchema = z.object({ outcomes: z.array(outcomeSchema) })

/** The item form's rule for the same field: commas, whitespace or new lines between IDs, duplicates dropped. */
function parseMerchantIds(value: string): string[] {
	return [
		...new Set(
			value
				.split(/[\s,]+/)
				.map(id => id.trim())
				.filter(Boolean),
		),
	]
}

const cardWord = (n: number) => (n === 1 ? "card" : "cards")

/**
 * The bulk card send: one panel per item, because the merchant allowlist and the amount are the item's.
 *
 * Every listed order already asked for a card – the page's query is what decides that – so this only chooses who is included, what the cards are locked to, and whether the lock is kept on the catalogue. Issuing goes through the single-order path, which marks the order fulfilled in the same transaction.
 */
export function CardBatch({ blocked, groups }: Readonly<{ blocked: BatchBlockedOrder[]; groups: BatchGroup[] }>) {
	return (
		<>
			<Panel title="Bulk card send">
				<p className="hl-hint" style={{ margin: 0 }}>
					Only orders whose buyer chose a grant card instead of shipping are listed. Each card is locked to the merchant
					IDs you enter for its item, and sending it marks the order fulfilled, so the buyer can no longer cancel it.
					Orders that cannot be sent yet are listed below rather than disappearing from the sheet.
				</p>
			</Panel>

			{groups.length === 0 ? (
				<Panel title="Ready to send">
					<EmptyState>No order is waiting on a grant card with an amount to send.</EmptyState>
				</Panel>
			) : (
				groups.map(group => <BatchItemPanel group={group} key={group.shopItemId} />)
			)}

			{blocked.length > 0 ? (
				<Panel title="Requested a card, but not sendable">
					<Table head={["#", "Participant", "Item", "Why"]}>
						{blocked.map(order => (
							<tr key={order.orderNumber}>
								<td className="hl-mono">{order.orderNumber}</td>
								<td>
									<Link className="hl-entity-name" href={`/admin/users/${order.user.id}`}>
										{order.user.name}
									</Link>
								</td>
								<td>
									<Link href={`/admin/shop/${order.shopItemId}`}>{order.itemName}</Link>
								</td>
								<td className="hl-hint">{order.reason}</td>
							</tr>
						))}
					</Table>
					<p className="hl-hint">
						These asked for a card and still have one to receive, but nothing can be sent for them yet. A missing amount
						means the item had no cost when it was bought, so there is nothing to put on the card.
					</p>
				</Panel>
			) : null}
		</>
	)
}

function BatchItemPanel({ group }: Readonly<{ group: BatchGroup }>) {
	const [allowlist, setAllowlist] = useState(group.configuredMerchantIds.join(", "))
	const [selected, setSelected] = useState<string[]>(() => group.orders.map(order => order.id))
	const [saveToItem, setSaveToItem] = useState(true)
	const [outcomes, setOutcomes] = useState<BatchSendOutcome[] | null>(null)
	const { busy, error, run } = useAction()
	const { confirm, dialog } = useConfirm()

	const merchantIds = parseMerchantIds(allowlist)
	const chosen = group.orders.filter(order => selected.includes(order.id))
	const totalCents = chosen.reduce((n, order) => n + order.amountCents, 0)
	// Read off what is still listed rather than the raw selection: after a partial send the orders that went through are gone, and the ones left should still read as all chosen.
	const allChosen = group.orders.length > 0 && chosen.length === group.orders.length
	const sending = busy === "send"

	const failures = outcomes?.filter(outcome => !outcome.sent) ?? []
	const sent = outcomes?.filter(outcome => outcome.sent).length ?? 0

	function toggle(id: string) {
		setSelected(current => (current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id]))
	}

	function toggleAll() {
		setSelected(allChosen ? [] : group.orders.map(order => order.id))
	}

	async function send() {
		const answer = await confirm({
			confirmLabel: `Send ${chosen.length} ${cardWord(chosen.length)}`,
			message: `Send ${chosen.length} ${cardWord(chosen.length)} for "${group.itemName}", ${formatUsd(
				totalCents / 100,
			)} in total, usable only at ${merchantIds.join(", ")}? Each order is marked fulfilled once its card is issued, and the buyer can no longer cancel it.`,
			title: `Send ${group.itemName} ${cardWord(chosen.length)}`,
		})
		if (answer === null) return
		void run(
			"send",
			() =>
				sendJsonParsed(sendResultSchema, "/api/admin/shop/grant-cards/batch", {
					body: {
						grantCardMerchantIds: merchantIds,
						orderIds: chosen.map(order => order.id),
						saveToItem,
						shopItemId: group.shopItemId,
					},
				}),
			data => setOutcomes(data.outcomes),
		)
	}

	return (
		<Panel
			actions={
				<Link className="hl-hint" href={`/admin/shop/${group.shopItemId}`}>
					Edit item
				</Link>
			}
			title={
				<>
					<Link href={`/admin/shop/${group.shopItemId}`}>{group.itemName}</Link>{" "}
					<span className="hl-hint">{chosen.length} selected</span>
				</>
			}
		>
			<Table head={["", "#", "Participant", "Placed", "Amount"]}>
				<tr>
					<td>
						<input
							aria-label={`Include every ${group.itemName} order`}
							checked={allChosen}
							onChange={toggleAll}
							type="checkbox"
						/>
					</td>
					<td className="hl-hint" colSpan={4}>
						{allChosen ? "Every waiting order is included" : "Choose the orders to send"}
					</td>
				</tr>
				{group.orders.map(order => (
					<tr key={order.id}>
						<td>
							<input
								aria-label={`Include order #${order.orderNumber}`}
								checked={selected.includes(order.id)}
								onChange={() => toggle(order.id)}
								type="checkbox"
							/>
						</td>
						<td className="hl-mono">{order.orderNumber}</td>
						<td>
							<Link className="hl-entity-name" href={`/admin/users/${order.user.id}`}>
								{order.user.name}
							</Link>
						</td>
						<td className="hl-mono">{formatUtcDateTime(new Date(order.placedAt))}</td>
						<td className="hl-mono">{formatUsd(order.amountCents / 100)}</td>
					</tr>
				))}
			</Table>

			<Field
				hint={
					group.configuredMerchantIds.length === 0
						? "This item has no allowlist yet. Enter the vendor's Stripe merchant network IDs before sending, or the cards would be usable anywhere."
						: "Defaults to the item's allowlist. Blank lets a card be used anywhere, so at least one ID is required here."
				}
				label="Grant card merchant IDs"
			>
				<TextArea
					onChange={event => setAllowlist(event.target.value)}
					placeholder="e.g. ZIEMZSLZHABHDPK, BCY7WW5ESKW7NNL"
					rows={2}
					value={allowlist}
				/>
			</Field>

			<label className="hl-row" style={{ gap: "0.5rem" }}>
				<input checked={saveToItem} onChange={event => setSaveToItem(event.target.checked)} type="checkbox" />
				<span>Save this allowlist to the item for the orders that come after</span>
			</label>

			{merchantIds.length === 0 ? (
				<Callout tone="warning">
					Enter at least one merchant ID. A card with no lock could be spent with any vendor.
				</Callout>
			) : null}
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{sent > 0 ? (
				<Callout tone="info">
					Issued {sent} {cardWord(sent)}. The orders left in this panel are the ones that did not go through.
				</Callout>
			) : null}
			{failures.length > 0 ? (
				<Callout tone="danger">
					<strong>
						{failures.length} {cardWord(failures.length)} not issued
					</strong>
					<ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
						{failures.map(outcome => (
							<li key={outcome.orderId}>
								Order #{outcome.orderNumber}: {outcome.error ?? "HCB did not confirm the card"}
							</li>
						))}
					</ul>
				</Callout>
			) : null}

			<div className="hl-row" style={{ alignItems: "center", gap: "0.75rem" }}>
				<Button
					disabled={sending || merchantIds.length === 0 || chosen.length === 0}
					onClick={() => void send()}
					type="button"
					variant="primary"
				>
					{sending ? "Sending…" : `Send ${chosen.length} ${cardWord(chosen.length)} · ${formatUsd(totalCents / 100)}`}
				</Button>
				<span className="hl-hint">
					{merchantIds.length > 0 ? `Locked to ${merchantIds.join(", ")}` : "No merchant lock entered yet"}
				</span>
			</div>
			{dialog}
		</Panel>
	)
}
