import { HcbGrantCardStatus } from "../src/lib/enums"
import { readCardGrantSpend } from "../src/lib/hcb"
import db from "../src/lib/prisma8"

/**
 * Every HCB card grant issued to one maker, with a link to each and how much has been spent on it.
 *
 * "Issued" is the local `ISSUED` status on `HcbGrantCard`. Each row links to the grant on HCB (`/grants/<hcbCardGrantId>`), then reads the grant's balance and its card's total spend from HCB's v4 API (`card_grants/<id>?expand=balance_cents` and `cards/<card_id>?expand=total_spent_cents`). The v3 API has no card grants and its card record carries no spend, so v4 is the only option. A null figure means HCB did not return it, not zero.
 *
 * Read-only. Needs `HCB_ORG_SLUG` and either `HCB_ACCESS_TOKEN` or the refresh-token set, the same as the app:
 *
 *   bun --conditions=react-server scripts/user-grant-card-spend.ts maker@example.com
 *
 * Output is one line per grant, tab-separated: the link, issued amount, balance left, card spend, and card id. The summary goes to stderr.
 */

const dollars = (cents: number | null): string => (cents === null ? "unknown" : `$${(cents / 100).toFixed(2)}`)

async function main(): Promise<void> {
	const email = process.argv[2]?.trim()
	if (!email) throw new Error("Usage: user-grant-card-spend.ts <email>")

	const [user] = await db.orm.public.User.where({ email }).select("email", "id").all()
	if (!user) throw new Error(`No user with the email ${email}`)

	const cards = await db.orm.public.HcbGrantCard.where({ status: HcbGrantCardStatus.ISSUED, userId: user.id })
		.select("hcbCardGrantId", "phase", "themeProjectId")
		.all()

	for (const card of cards) {
		if (!card.hcbCardGrantId) continue
		const spend = await readCardGrantSpend(card.hcbCardGrantId)
		const link = `https://hcb.hackclub.com/grants/${card.hcbCardGrantId}`
		console.log(
			[
				link,
				dollars(spend.amountCents),
				dollars(spend.balanceCents),
				dollars(spend.spentCents),
				spend.cardId ?? "-",
			].join("\t"),
		)
	}

	console.error(`${cards.length} issued grant card(s) for ${user.email}`)
}

await main()
