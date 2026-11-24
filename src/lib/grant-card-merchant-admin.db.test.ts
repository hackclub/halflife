import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { HttpError } from "@/lib/errors"
import {
	createGrantCardMerchant,
	deleteGrantCardMerchant,
	setItemMerchants,
	updateGrantCardMerchant,
} from "@/lib/grant-card-merchant-admin"
import db from "@/lib/prisma8"

/**
 * Runs only against a throwaway `*_e2e` database, because it writes rows. Any other DATABASE_URL skips the suite, so an ordinary test run never touches the dev database.
 *
 * Run with `DATABASE_URL=postgresql://…/halflife_merchants_e2e bun --conditions=react-server test src/lib/grant-card-merchant-admin.db.test.ts`.
 */
const scratch = /\/[A-Za-z0-9_]*_e2e(\?|$)/.test(process.env.DATABASE_URL ?? "")
const suffix = Math.random().toString(36).slice(2, 8)
const itemId = `merchant-test-${suffix}`
const actor = { email: null, id: null }

async function flatIds(): Promise<string[]> {
	const item = await db.orm.public.ShopItem.whereUnique({ id: itemId }).select("grantCardMerchantIds").first()
	return [...(item?.grantCardMerchantIds ?? [])].toSorted()
}

function link(merchantIds: string[]): Promise<string[]> {
	return db.transaction(tx => setItemMerchants(tx, itemId, merchantIds))
}

describe.skipIf(!scratch)("grant card merchants against a database", () => {
	let alpha = ""
	let beta = ""

	beforeAll(async () => {
		await db.orm.public.ShopItem.create({ description: "Test", id: itemId, name: "Test item", priceCredits: 10 })
		alpha = (await createGrantCardMerchant({ merchantIds: ["1", "2"], name: `Alpha ${suffix}`, sourceNote: "" }, actor))
			.id
		beta = (await createGrantCardMerchant({ merchantIds: ["2", "3"], name: `Beta ${suffix}`, sourceNote: "" }, actor))
			.id
	})

	afterAll(async () => {
		await link([])
		for (const id of [alpha, beta]) if (id) await db.orm.public.GrantCardMerchant.where({ id }).delete()
		await db.orm.public.ShopItem.where({ id: itemId }).delete()
	})

	test("an item's list is the union of its merchants' IDs, without duplicates", async () => {
		await link([alpha, beta])
		expect(await flatIds()).toEqual(["1", "2", "3"])
	})

	test("editing a merchant recomputes every item it is linked to", async () => {
		await updateGrantCardMerchant(alpha, { merchantIds: ["1", "9"] }, actor)
		expect(await flatIds()).toEqual(["1", "2", "3", "9"])
		await updateGrantCardMerchant(alpha, { merchantIds: ["1", "2"] }, actor)
		expect(await flatIds()).toEqual(["1", "2", "3"])
	})

	test("unlinking a merchant takes its IDs off the item, and keeps the rest", async () => {
		await link([beta])
		expect(await flatIds()).toEqual(["2", "3"])
	})

	test("a merchant still linked to an item cannot be deleted", async () => {
		await link([alpha])
		const error = await deleteGrantCardMerchant(alpha, actor).catch((caught: unknown) => caught)
		expect(error).toBeInstanceOf(HttpError)
		expect((error as HttpError).code).toBe("CONFLICT")
	})

	test("clearing every merchant leaves the item unrestricted", async () => {
		await link([])
		expect(await flatIds()).toEqual([])
	})

	test("linking a merchant that does not exist is refused and changes nothing", async () => {
		await link([beta])
		const error = await link([beta, "no-such-merchant"]).catch((caught: unknown) => caught)
		expect((error as HttpError).code).toBe("VALIDATION_FAILED")
		expect(await flatIds()).toEqual(["2", "3"])
	})
})
