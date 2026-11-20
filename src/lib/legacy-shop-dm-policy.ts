import { z } from "zod"
import type { ShopDeliveryPreference } from "@/lib/enums"
import type { SlackBlock } from "@/lib/site/slack"

/**
 * The parts of the legacy-order DM that are pure: who is messaged, what the message says, and what a button click means.
 *
 * Kept out of the database and Slack modules so the rules can be tested without either. The send and the click handler both build on these.
 */

/** The action IDs on the DM's buttons. The interactions route dispatches on them. */
export const LEGACY_SHOP_CHOICE_ACTION = "legacy_shop_choice"
export const LEGACY_SHOP_TEST_ACTION = "legacy_shop_test"

/**
 * A Slack block holds at most 50 blocks, and each order takes two (its text and its buttons), with one for the intro. A buyer with more orders than this is skipped rather than split, because one DM per buyer is the point.
 */
export const LEGACY_SHOP_DM_MAX_ORDERS = 24

const SLACK_USER_ID = /^[UW][A-Z0-9]{5,}$/

/** Whether a string is shaped like a Slack user ID (U… or W…). A shape check only; it does not prove the user exists. */
export const isSlackUserId = (value: string): boolean => SLACK_USER_ID.test(value)

const CHOICE_LABELS: { [_: string]: string } = {
	GRANT_CARD: "Grant card",
	SHIP: "Ship it",
}

const BUYER_INTRO =
	"A few of your Half Life shop orders were placed before you could choose how to get them. For each one, tell us whether to ship the item to you or give you a grant card for its value. Nothing changes yet: we'll confirm when fulfilment opens and what it covers before anything is sent."

const TEST_INTRO =
	"Test message from the Half Life admin panel. The buttons are here to check how the message looks; pressing them changes no order."

const ButtonValueSchema = z.object({
	choice: z.enum(["GRANT_CARD", "SHIP"]),
	orderId: z.string().trim().min(1).max(64).optional(),
	test: z.boolean().optional(),
})

export type LegacyShopButtonValue = z.infer<typeof ButtonValueSchema>

export const legacyShopButtonValue = (value: LegacyShopButtonValue): string => JSON.stringify(value)

/** The button's value, checked rather than trusted: a click with a malformed or unknown value changes nothing. */
export function parseLegacyShopButtonValue(value: string | undefined): LegacyShopButtonValue | null {
	if (!value) return null
	let raw: unknown
	try {
		raw = JSON.parse(value)
	} catch {
		return null
	}
	const parsed = ButtonValueSchema.safeParse(raw)
	return parsed.success ? parsed.data : null
}

/** One order as the message shows it. `orderId` is null on the test message's sample line. */
export interface LegacyShopLine {
	choice: ShopDeliveryPreference | null
	itemName: string
	orderId: string | null
	orderNumber: number | null
}

/** Slack's mrkdwn treats these three characters as markup, so item names are escaped before they go in a message. */
const escapeMrkdwn = (text: string): string =>
	text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

function lineBlocks(line: LegacyShopLine, test: boolean): SlackBlock[] {
	const heading = line.orderNumber === null ? "Sample order" : `Order #${line.orderNumber}`
	const current = line.choice ? `Your choice: ${CHOICE_LABELS[line.choice]}` : "No choice yet"
	const button = (choice: "GRANT_CARD" | "SHIP"): SlackBlock => ({
		action_id: LEGACY_SHOP_CHOICE_ACTION,
		text: { emoji: true, text: CHOICE_LABELS[choice], type: "plain_text" },
		type: "button",
		value: legacyShopButtonValue({ choice, orderId: line.orderId ?? undefined, test: test || undefined }),
	})

	return [
		{
			text: {
				text: `*${heading}* – ${escapeMrkdwn(line.itemName)}\n${current}`,
				type: "mrkdwn",
			},
			type: "section",
		},
		{
			block_id: `legacy-order-${line.orderId ?? "sample"}`,
			elements: [button("SHIP"), button("GRANT_CARD")],
			type: "actions",
		},
	]
}

/** The DM for one buyer, or the test DM when `test` is set. Its fallback text is what a notification shows. */
export function legacyShopMessage(lines: LegacyShopLine[], test: boolean): { blocks: SlackBlock[]; text: string } {
	const intro: SlackBlock = { text: { text: test ? TEST_INTRO : BUYER_INTRO, type: "mrkdwn" }, type: "section" }
	return {
		blocks: [intro, ...lines.flatMap(line => lineBlocks(line, test))],
		text: test ? "Test: Half Life shop delivery message" : "Your Half Life shop orders need a delivery choice",
	}
}

/** An open order that no live DM has listed yet, with what its DM needs. */
export interface LegacyShopOrderRow {
	itemName: string
	orderId: string
	orderNumber: number
	userId: string
}

export interface LegacyShopBuyer {
	orders: LegacyShopOrderRow[]
	/** Why this buyer cannot be messaged, or null when they can. */
	skipReason: string | null
	slackId: string | null
	userId: string
}

/**
 * Groups the open legacy orders by buyer, leaving out any order a live DM already lists, and says why a buyer cannot be messaged.
 *
 * `sentOrderIds` is every order a PENDING or SENT DM holds. Leaving those out here is what keeps the preview from offering a buyer a second DM; the database's partial unique index is what stops one getting through anyway.
 */
export function groupLegacyShopBuyers(
	orders: LegacyShopOrderRow[],
	sentOrderIds: ReadonlySet<string>,
	slackIds: ReadonlyMap<string, string | null>,
): LegacyShopBuyer[] {
	const byUser = new Map<string, LegacyShopOrderRow[]>()
	for (const order of orders) {
		if (sentOrderIds.has(order.orderId)) continue
		const list = byUser.get(order.userId) ?? []
		list.push(order)
		byUser.set(order.userId, list)
	}

	return [...byUser].map(([userId, list]) => {
		const slackId = slackIds.get(userId) ?? null
		return {
			orders: list.sort((a, b) => a.orderNumber - b.orderNumber),
			skipReason: legacyShopSkipReason(slackId, list.length),
			slackId,
			userId,
		}
	})
}

function legacyShopSkipReason(slackId: string | null, orderCount: number): string | null {
	if (!slackId) return "No Slack ID on the account"
	if (!isSlackUserId(slackId)) return "The Slack ID on the account is not in a valid shape"
	if (orderCount > LEGACY_SHOP_DM_MAX_ORDERS)
		return `More than ${LEGACY_SHOP_DM_MAX_ORDERS} open orders, too many for one DM`
	return null
}
