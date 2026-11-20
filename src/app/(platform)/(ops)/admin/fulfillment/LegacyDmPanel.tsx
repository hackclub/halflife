"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { z } from "zod"
import { Badge, Button, Callout, EmptyState, Field, Panel, Table, TextInput } from "@/app/components/ui"
import { useConfirm } from "@/app/components/ui/useConfirm"
import { formatUtcDateTime } from "@/lib/deadline"
import type { LegacyShopDmRecord, LegacyShopPreview, LegacyShopSendOutcome } from "@/lib/legacy-shop-dm"
import type { LegacyShopBuyer } from "@/lib/legacy-shop-dm-policy"
import { LEGACY_SHOP_DM_SEND_MAX } from "@/lib/schemas/admin"
import { parseDbTimestamp } from "@/lib/time"
import { sendJsonParsed } from "@/lib/use-action"

const sendResultSchema = z.object({
	outcomes: z.array(
		z.object({
			reason: z.string().nullable(),
			status: z.enum(["FAILED", "SENT", "SKIPPED"]),
			userId: z.string(),
		}),
	),
})

const testResultSchema = z.object({
	result: z.object({
		error: z.string().nullable(),
		status: z.enum(["FAILED", "SENT"]),
	}),
})

const CHOICE_LABELS: { [_: string]: string } = {
	GRANT_CARD: "Grant card",
	SHIP: "Ship it",
}

const STATUS_LABELS: { [_: string]: string } = {
	FAILED: "Failed",
	PENDING: "Sending",
	SENT: "Sent",
}

const STATUS_TONES: { [_: string]: "danger" | "muted" | "success" } = {
	FAILED: "danger",
	PENDING: "muted",
	SENT: "success",
}

const noun = (count: number, one: string, many: string): string => (count === 1 ? one : many)

function chunkOf<T>(items: readonly T[], size: number): T[][] {
	const chunks: T[][] = []
	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
	return chunks
}

/**
 * The legacy-order DM tab: who would be messaged, a send that asks first, a test to one Slack ID, and the history of every DM sent.
 *
 * Nothing here changes an order. A DM's buttons record the buyer's answer on the DM, and the order's delivery preference stays as it is until fulfilment is settled.
 */
export function LegacyDmPanel({ preview }: Readonly<{ preview: LegacyShopPreview }>) {
	return (
		<>
			<SendPanel buyers={preview.buyers} />
			<TestPanel />
			<HistoryPanel history={preview.history} />
		</>
	)
}

function SendPanel({ buyers }: Readonly<{ buyers: LegacyShopBuyer[] }>) {
	const router = useRouter()
	const { confirm, dialog } = useConfirm()
	const eligible = buyers.filter(buyer => buyer.skipReason === null)
	const skipped = buyers.filter(buyer => buyer.skipReason !== null)
	const [picked, setPicked] = useState<string[]>(() => eligible.map(buyer => buyer.userId))
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [outcomes, setOutcomes] = useState<LegacyShopSendOutcome[] | null>(null)

	const chosen = eligible.filter(buyer => picked.includes(buyer.userId))
	const orderCount = chosen.reduce((n, buyer) => n + buyer.orders.length, 0)
	const sent = outcomes?.filter(outcome => outcome.status === "SENT").length ?? 0
	const skippedNow = outcomes?.filter(outcome => outcome.status === "SKIPPED") ?? []
	const failed = outcomes?.filter(outcome => outcome.status === "FAILED") ?? []
	const slackIdOf = (userId: string): string => buyers.find(buyer => buyer.userId === userId)?.slackId ?? userId

	function toggle(userId: string) {
		setPicked(current => (current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId]))
	}

	async function send() {
		const answer = await confirm({
			confirmLabel: `Message ${chosen.length} ${noun(chosen.length, "buyer", "buyers")}`,
			message: `Send a Slack DM to ${chosen.length} ${noun(chosen.length, "buyer", "buyers")} about ${orderCount} open ${noun(orderCount, "order", "orders")}? Each DM lists that buyer's orders with buttons for ship it or grant card. Nothing changes on an order until the buyer presses a button, and a buyer already sent a DM for an order is not messaged again.`,
			title: "Send legacy order DMs",
		})
		if (answer === null) return

		setBusy(true)
		setError(null)
		const collected: LegacyShopSendOutcome[] = []
		try {
			for (const chunk of chunkOf(
				chosen.map(buyer => buyer.userId),
				LEGACY_SHOP_DM_SEND_MAX,
			)) {
				const result = await sendJsonParsed(sendResultSchema, "/api/admin/fulfillment/legacy-dm/send", {
					body: { userIds: chunk },
				})
				if (!result.ok) {
					setError(result.message)
					return
				}
				collected.push(...result.data.outcomes)
			}
		} finally {
			// Whatever went out is recorded and the page re-read, even when a later chunk was refused.
			setOutcomes(collected)
			setBusy(false)
			router.refresh()
		}
	}

	return (
		<Panel title="Send">
			<p className="hl-hint" style={{ margin: 0 }}>
				One DM per buyer, listing each of their open orders placed before the delivery choice existed. Buyers already
				sent a DM for an order are left out, so nothing is messaged twice.
			</p>
			{error ? <Callout tone="danger">{error}</Callout> : null}
			{sent > 0 ? (
				<Callout tone="info">
					Sent {sent} {noun(sent, "DM", "DMs")}.
				</Callout>
			) : null}
			{failed.length > 0 ? (
				<Callout tone="danger">
					<strong>
						{failed.length} {noun(failed.length, "DM", "DMs")} not sent
					</strong>
					<ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.1rem" }}>
						{failed.map(outcome => (
							<li key={outcome.userId}>
								{slackIdOf(outcome.userId)}: {outcome.reason ?? "Slack did not confirm the message"}
							</li>
						))}
					</ul>
				</Callout>
			) : null}
			{skippedNow.length > 0 ? (
				<Callout tone="warning">
					Skipped {skippedNow.length} {noun(skippedNow.length, "buyer", "buyers")}:{" "}
					{skippedNow.map(outcome => `${slackIdOf(outcome.userId)} (${outcome.reason ?? "not eligible"})`).join(", ")}.
				</Callout>
			) : null}

			{eligible.length === 0 ? (
				<EmptyState>No open legacy order is waiting for a DM.</EmptyState>
			) : (
				<Table head={["", "Slack ID", "Orders", "Items"]}>
					{eligible.map(buyer => (
						<tr key={buyer.userId}>
							<td>
								<input
									aria-label={`Message ${buyer.slackId}`}
									checked={picked.includes(buyer.userId)}
									onChange={() => toggle(buyer.userId)}
									type="checkbox"
								/>
							</td>
							<td className="hl-mono">{buyer.slackId}</td>
							<td className="hl-mono">{buyer.orders.map(order => `#${order.orderNumber}`).join(", ")}</td>
							<td>{buyer.orders.map(order => order.itemName).join(", ")}</td>
						</tr>
					))}
				</Table>
			)}

			<div className="hl-row" style={{ alignItems: "center", gap: "0.75rem" }}>
				<Button disabled={busy || chosen.length === 0} onClick={() => void send()} type="button" variant="primary">
					{busy
						? "Sending…"
						: `Message ${chosen.length} ${noun(chosen.length, "buyer", "buyers")} · ${orderCount} ${noun(orderCount, "order", "orders")}`}
				</Button>
			</div>

			{skipped.length > 0 ? (
				<>
					<p className="hl-hint" style={{ margin: 0 }}>
						Not messaged:
					</p>
					<Table head={["Slack ID", "Orders", "Left out because"]}>
						{skipped.map(buyer => (
							<tr key={buyer.userId}>
								<td className="hl-mono">{buyer.slackId ?? "none"}</td>
								<td className="hl-mono">{buyer.orders.map(order => `#${order.orderNumber}`).join(", ")}</td>
								<td>{buyer.skipReason}</td>
							</tr>
						))}
					</Table>
				</>
			) : null}
			{dialog}
		</Panel>
	)
}

function TestPanel() {
	const router = useRouter()
	const [slackId, setSlackId] = useState("")
	const [busy, setBusy] = useState(false)
	const [result, setResult] = useState<{ text: string; tone: "danger" | "info" } | null>(null)

	async function sendTest() {
		const target = slackId.trim()
		setBusy(true)
		setResult(null)
		try {
			const answer = await sendJsonParsed(testResultSchema, "/api/admin/fulfillment/legacy-dm/test", {
				body: { slackId: target },
			})
			if (!answer.ok) {
				setResult({ text: answer.message, tone: "danger" })
				return
			}
			setResult(
				answer.data.result.status === "SENT"
					? { text: `Test sent to ${target}. It is in the history below.`, tone: "info" }
					: { text: `Not sent: ${answer.data.result.error ?? "Slack did not confirm the message"}`, tone: "danger" },
			)
		} finally {
			setBusy(false)
			router.refresh()
		}
	}

	return (
		<Panel title="Test">
			<p className="hl-hint" style={{ margin: 0 }}>
				Sends the same message to one Slack user ID, with a sample order. It is recorded in the history, but it is not
				counted as a buyer&rsquo;s DM and changes no order.
			</p>
			<div className="hl-row" style={{ alignItems: "flex-end", gap: "0.75rem" }}>
				<Field hint="A user ID starts with U or W, for example U0123ABCDE." label="Slack user ID">
					<TextInput
						onChange={event => setSlackId(event.target.value)}
						placeholder="U0123ABCDE"
						spellCheck={false}
						value={slackId}
					/>
				</Field>
				<Button disabled={busy || slackId.trim() === ""} onClick={() => void sendTest()} type="button">
					{busy ? "Sending…" : "Send test"}
				</Button>
			</div>
			{result ? <Callout tone={result.tone}>{result.text}</Callout> : null}
		</Panel>
	)
}

function HistoryPanel({ history }: Readonly<{ history: LegacyShopDmRecord[] }>) {
	return (
		<Panel title="History">
			{history.length === 0 ? (
				<EmptyState>No DM has been sent yet.</EmptyState>
			) : (
				<Table head={["Sent", "To", "Orders", "Status", "Answers"]}>
					{history.map(dm => (
						<tr key={dm.id}>
							<td className="hl-mono">{formatUtcDateTime(parseDbTimestamp(dm.sentAt ?? dm.createdAt))}</td>
							<td className="hl-mono">
								{dm.slackId}
								{dm.test ? <span className="hl-hint"> · test</span> : null}
							</td>
							<td className="hl-mono">
								{dm.orders.length === 0 ? (
									<span className="hl-hint">None</span>
								) : (
									dm.orders.map(order => `#${order.orderNumber}`).join(", ")
								)}
							</td>
							<td>
								<Badge tone={STATUS_TONES[dm.status]}>{STATUS_LABELS[dm.status]}</Badge>
								{dm.error ? <div className="hl-hint">{dm.error}</div> : null}
							</td>
							<td>
								{dm.orders.map(order => (
									<div key={order.orderId}>
										#{order.orderNumber}: {order.choice ? CHOICE_LABELS[order.choice] : "no answer yet"}
									</div>
								))}
							</td>
						</tr>
					))}
				</Table>
			)}
		</Panel>
	)
}
