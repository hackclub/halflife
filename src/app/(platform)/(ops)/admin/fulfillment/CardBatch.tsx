"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { z } from "zod"
import { Button, Callout, EmptyState, Panel, Table } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { formatUtcDateTime } from "@/lib/deadline"
import { formatUsd } from "@/lib/money"
import { SHOP_GRANT_CARD_BATCH_MAX } from "@/lib/schemas/admin"
import type { BatchBlockedOrder, BatchGroup, BatchSendOutcome } from "@/lib/shop-grant-card-batch"
import { sendJsonParsed, useAction } from "@/lib/use-action"

const outcomeSchema = z.object({
	error: z.string().nullable(),
	orderId: z.string(),
	orderNumber: z.number(),
	sent: z.boolean(),
})

const sendResultSchema = z.object({ outcomes: z.array(outcomeSchema) })

const cardWord = (n: number) => (n === 1 ? "card" : "cards")

/**
 * The bulk card send: one panel per item, because the merchants the cards may be spent at are the item's.
 *
 * Every listed order already asked for a card – the page's query is what decides that – so this only chooses who is included. The merchants come from the item's links, never typed here. Issuing goes through the single-order path, which marks the order fulfilled in the same transaction.
 */
export function CardBatch({ blocked, groups }: Readonly<{ blocked: BatchBlockedOrder[]; groups: BatchGroup[] }>) {
	return (
		<>
			{groups.length > 0 ? <SendEverythingPanel groups={groups} /> : null}

			<Panel title="Bulk card send">
				<p className="hl-hint" style={{ margin: 0 }}>
					Only orders whose buyer chose a grant card instead of shipping are listed. Each card may only be spent at the
					merchants linked to its item, and sending it marks the order fulfilled, so the buyer can no longer cancel it.
					Orders that cannot be sent yet are listed below rather than disappearing from the sheet.
				</p>
			</Panel>

			{groups.length === 0 ? (
				<Panel title="Ready to send">
					<EmptyState>No order is waiting on a grant card with an amount to send.</EmptyState>
				</Panel>
			) : (
				<div className="hl-batch-grid">
					{groups.map(group => (
						<BatchItemPanel group={group} key={group.shopItemId} />
					))}
				</div>
			)}

			{blocked.length > 0 ? <BlockedOrders blocked={blocked} /> : null}
		</>
	)
}

const fillOutcomeSchema = z.object({
	amountCents: z.number().nullable(),
	error: z.string().nullable(),
	filled: z.boolean(),
	orderId: z.string(),
	orderNumber: z.number().nullable(),
})

const fillResultSchema = z.object({ outcomes: z.array(fillOutcomeSchema) })

/**
 * The orders that asked for a card but cannot be sent. Ones with no amount can be ticked and given the item's current cost, which is what a fresh purchase would have snapshotted.
 */
function BlockedOrders({ blocked }: Readonly<{ blocked: BatchBlockedOrder[] }>) {
	const [selected, setSelected] = useState<string[]>([])
	const [outcomes, setOutcomes] = useState<z.infer<typeof fillOutcomeSchema>[] | null>(null)
	const { busy, error, run } = useAction()
	const { confirm, dialog } = useConfirm()

	const fillable = blocked.filter(order => order.fillable)
	const chosen = fillable.filter(order => selected.includes(order.orderId))
	const allChosen = fillable.length > 0 && chosen.length === fillable.length
	const filling = busy === "fill"
	const failures = outcomes?.filter(outcome => !outcome.filled) ?? []
	const filled = outcomes?.filter(outcome => outcome.filled).length ?? 0

	function toggle(id: string) {
		setSelected(current => (current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id]))
	}

	function toggleAll() {
		setSelected(allChosen ? [] : fillable.map(order => order.orderId))
	}

	async function fill() {
		const answer = await confirm({
			confirmLabel: `Fill ${chosen.length} ${chosen.length === 1 ? "amount" : "amounts"}`,
			message: `Give ${chosen.length} ${cardWord(chosen.length)} an amount from each item's current cost? These orders were placed before their item had a cost, so the card would carry today's cost times the quantity. The orders can then be sent as cards.`,
			title: "Fill with current cost",
		})
		if (answer === null) return
		void run(
			"fill",
			() =>
				sendJsonParsed(fillResultSchema, "/api/admin/shop/orders/grant-card-amounts", {
					body: { orderIds: chosen.map(order => order.orderId) },
				}),
			data => {
				setOutcomes(data.outcomes)
				setSelected([])
			},
		)
	}

	return (
		<Panel title="Requested a card, but not sendable">
			<Table head={["", "#", "Participant", "Item", "Why"]}>
				<tr>
					<td>
						<input
							aria-label="Include every order that can be filled"
							checked={allChosen}
							disabled={fillable.length === 0}
							onChange={toggleAll}
							type="checkbox"
						/>
					</td>
					<td className="hl-hint" colSpan={4}>
						{fillable.length === 0
							? "Nothing here can be filled"
							: allChosen
								? "Every fillable order is included"
								: "Choose the orders to fill"}
					</td>
				</tr>
				{blocked.map(order => (
					<tr key={order.orderId}>
						<td>
							<input
								aria-label={`Include order #${order.orderNumber}`}
								checked={selected.includes(order.orderId)}
								disabled={!order.fillable}
								onChange={() => toggle(order.orderId)}
								type="checkbox"
							/>
						</td>
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
			<p className="hl-hint" style={{ margin: 0 }}>
				These asked for a card and still have one to receive, but nothing can be sent for them yet. A missing amount
				means the item had no cost when it was bought. Filling one takes the item&apos;s current cost times the
				quantity.
			</p>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{filled > 0 ? (
				<Callout tone="info">
					Filled {filled} {filled === 1 ? "amount" : "amounts"}. Reloading the page moves them to the send list.
				</Callout>
			) : null}
			{failures.length > 0 ? (
				<Callout tone="danger">
					<strong>{failures.length} not filled</strong>
					<ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
						{failures.map(outcome => (
							<li key={outcome.orderId}>
								Order #{outcome.orderNumber ?? "?"}: {outcome.error ?? "not filled"}
							</li>
						))}
					</ul>
				</Callout>
			) : null}
			<div className="hl-row" style={{ alignItems: "center", gap: "0.75rem" }}>
				<Button disabled={filling || chosen.length === 0} onClick={() => void fill()} type="button">
					{filling ? "Filling…" : `Fill with current cost · ${chosen.length} selected`}
				</Button>
			</div>
			{dialog}
		</Panel>
	)
}

function chunkOf<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
	return chunks
}

/**
 * Every item's waiting cards in one send. Each item goes with the merchants linked to it, so the allowlist is never guessed: an item with none linked is left out and named, since a card with no lock is worse than one not yet sent.
 */
function SendEverythingPanel({ groups }: Readonly<{ groups: BatchGroup[] }>) {
	const router = useRouter()
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [outcomes, setOutcomes] = useState<BatchSendOutcome[] | null>(null)
	const { confirm, dialog } = useConfirm()

	const ready = groups.filter(group => group.configuredMerchantIds.length > 0)
	const unlocked = groups.filter(group => group.configuredMerchantIds.length === 0)
	const orderCount = ready.reduce((n, group) => n + group.orders.length, 0)
	const totalCents = ready.reduce((n, group) => n + group.totalCents, 0)
	const failures = outcomes?.filter(outcome => !outcome.sent) ?? []
	const sent = outcomes?.filter(outcome => outcome.sent).length ?? 0

	async function sendAll() {
		const answer = await confirm({
			confirmLabel: `Send ${orderCount} ${cardWord(orderCount)}`,
			message: `Send ${orderCount} ${cardWord(orderCount)} across ${ready.length} ${ready.length === 1 ? "item" : "items"}, ${formatUsd(
				totalCents / 100,
			)} in total? Each card is locked to the merchants linked to its item. Each order is marked fulfilled once its card is issued, and the buyer can no longer cancel it.`,
			title: "Send every card",
		})
		if (answer === null) return
		setBusy(true)
		setError(null)
		const collected: BatchSendOutcome[] = []
		const requests = ready.flatMap(group =>
			chunkOf(
				group.orders.map(order => order.id),
				SHOP_GRANT_CARD_BATCH_MAX,
			).map(chunk => ({ chunk, group })),
		)
		try {
			for (const { chunk, group } of requests) {
				const result = await sendJsonParsed(sendResultSchema, "/api/admin/shop/grant-cards/batch", {
					body: {
						grantCardMerchantIds: group.configuredMerchantIds,
						orderIds: chunk,
						shopItemId: group.shopItemId,
					},
				})
				if (!result.ok) {
					setError(result.message)
					return
				}
				collected.push(...result.data.outcomes)
			}
		} finally {
			// Whatever went through is recorded and the page re-read, even when a later request was refused.
			setOutcomes(collected)
			setBusy(false)
			router.refresh()
		}
	}

	return (
		<Panel title="Send every card">
			<p className="hl-hint" style={{ margin: 0 }}>
				Sends every waiting card for every item, each locked to the merchants linked to that item. Change an item&apos;s
				merchants on its shop page to include the change here.
			</p>
			{unlocked.length > 0 ? (
				<Callout tone="warning">
					Left out, because no merchants are linked to them yet: {unlocked.map(group => group.itemName).join(", ")}.
				</Callout>
			) : null}
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{sent > 0 ? (
				<Callout tone="info">
					Issued {sent} {cardWord(sent)}. Orders that did not go through are still waiting below.
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
				<Button disabled={busy || orderCount === 0} onClick={() => void sendAll()} type="button" variant="primary">
					{busy ? "Sending…" : `Send ${orderCount} ${cardWord(orderCount)} · ${formatUsd(totalCents / 100)}`}
				</Button>
				<span className="hl-hint">
					{ready.length} {ready.length === 1 ? "item" : "items"} with merchants linked
				</span>
			</div>
			{dialog}
		</Panel>
	)
}

function BatchItemPanel({ group }: Readonly<{ group: BatchGroup }>) {
	const [selected, setSelected] = useState<string[]>(() => group.orders.map(order => order.id))
	const [outcomes, setOutcomes] = useState<BatchSendOutcome[] | null>(null)
	const { busy, error, run } = useAction()
	const { confirm, dialog } = useConfirm()

	const merchantIds = group.configuredMerchantIds
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
			)} in total, usable only at ${group.merchantNames.join(", ")}? Each order is marked fulfilled once its card is issued, and the buyer can no longer cancel it.`,
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
						shopItemId: group.shopItemId,
					},
				}),
			data => setOutcomes(data.outcomes),
		)
	}

	return (
		<Panel
			actions={<span className="hl-hint">{chosen.length} selected</span>}
			title={<Link href={`/admin/shop/${group.shopItemId}`}>{group.itemName}</Link>}
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

			<p className="hl-hint" style={{ margin: 0 }}>
				{merchantIds.length > 0
					? `Usable only at ${group.merchantNames.join(", ")} (${merchantIds.length} IDs).`
					: "No merchants are linked to this item yet."}{" "}
				<Link href={`/admin/shop/${group.shopItemId}`}>Change them on the item</Link>
			</p>

			{merchantIds.length === 0 ? (
				<Callout tone="warning">
					Link at least one merchant to this item before sending. A card with no lock could be spent with any vendor.
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
			</div>
			{dialog}
		</Panel>
	)
}
