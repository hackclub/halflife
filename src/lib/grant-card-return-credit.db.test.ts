import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HcbGrantCardStatus, LedgerKind, Theme } from "@/lib/enums"
import { creditReturnedGrantCard, writeReturnCredit } from "@/lib/grant-card-return-credit"
import db from "@/lib/prisma8"

/**
 * Runs only against a throwaway `*_e2e` database, because it writes rows. Any other DATABASE_URL skips the suite, so an ordinary test run never touches the dev database.
 *
 * Run with `DATABASE_URL=postgresql://…/halflife_return_e2e bun --conditions=react-server test src/lib/grant-card-return-credit.db.test.ts`.
 */
const scratch = /\/[A-Za-z0-9_]*_e2e(\?|$)/.test(process.env.DATABASE_URL ?? "")
const suffix = Math.random().toString(36).slice(2, 8)
const makerEmail = `return-${suffix}@example.com`

describe.skipIf(!scratch)("returned parts cards against a database", () => {
	let userId = ""
	let projectId = ""
	let batchId = ""
	let firstCardId = ""
	let secondCardId = ""

	beforeAll(async () => {
		const user = await db.orm.public.User.create({ email: makerEmail })
		userId = user.id
		const project = await db.orm.public.ThemeProject.create({ theme: Theme.PCB, title: `Return ${suffix}`, userId })
		projectId = project.id
		const batch = await db.orm.public.HcbGrantCardBatch.create({ fingerprint: `return-${suffix}`, totalCents: 3000 })
		batchId = batch.id
		const card = {
			amountCents: 1500,
			batchId,
			email: makerEmail,
			returnedAt: "2026-11-24T12:00:00.000Z",
			status: HcbGrantCardStatus.RETURNED,
			themeProjectId: projectId,
			userId,
		}
		firstCardId = (await db.orm.public.HcbGrantCard.create({ ...card, hcbCardGrantId: `first-${suffix}` })).id
		secondCardId = (await db.orm.public.HcbGrantCard.create({ ...card, hcbCardGrantId: `second-${suffix}` })).id
	})

	afterAll(async () => {
		await db.orm.public.LedgerEntry.where({ userId }).delete()
		await db.orm.public.HcbGrantCard.where({ batchId }).delete()
		await db.orm.public.HcbGrantCardBatch.where({ id: batchId }).delete()
		await db.orm.public.ThemeProject.where({ id: projectId }).delete()
		await db.orm.public.User.where({ id: userId }).delete()
	})

	const write = (cardId: string, coins: number) =>
		writeReturnCredit({
			cardId,
			coins,
			leftoverCents: 0,
			projectId,
			title: `Return ${suffix}`,
			unpaidCents: coins * 100,
			userId,
		})

	const returnRows = () =>
		db.orm.public.LedgerEntry.where({ kind: LedgerKind.GRANT_CARD_RETURN, themeProjectId: projectId })
			.select("amount")
			.all()

	test("an admin cancel is held: nothing is paid and the card stays uncredited", async () => {
		const outcome = await creditReturnedGrantCard(firstCardId, "admin@hackclub.com")
		expect(outcome).toBe("held")
		const card = await db.orm.public.HcbGrantCard.whereUnique({ id: firstCardId }).select("coinsCreditedAt").first()
		expect(card?.coinsCreditedAt).toBeNull()
		expect(await returnRows()).toEqual([])
	})

	test("a credit writes one ledger row and stamps the card, and a second run changes nothing", async () => {
		expect(await write(firstCardId, 30)).toBe("credited")
		expect(await write(firstCardId, 30)).toBe("already")
		expect(await returnRows()).toEqual([{ amount: 30 }])
		const card = await db.orm.public.HcbGrantCard.whereUnique({ id: firstCardId }).select("returnCoins").first()
		expect(card?.returnCoins).toBe(30)
	})

	test("a second return on the same project is stamped with 0 and pays nothing", async () => {
		expect(await write(secondCardId, 30)).toBe("already")
		expect(await returnRows()).toEqual([{ amount: 30 }])
		const card = await db.orm.public.HcbGrantCard.whereUnique({ id: secondCardId }).select("returnCoins").first()
		expect(card?.returnCoins).toBe(0)
	})
})
