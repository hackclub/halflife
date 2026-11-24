import "server-only"
import { AuditAction, logAudit } from "@/lib/audit"
import { HttpError } from "@/lib/errors"
import { syncItemMerchantIds } from "@/lib/grant-card-merchant-links"
import { merchantSlug } from "@/lib/grant-card-merchants"
import db, { type DbOrTx } from "@/lib/prisma8"

interface Actor {
	email: string | null
	id: string
}

/**
 * Replace an item's merchant links with exactly `merchantIds`, then recompute its flat list. Runs inside the caller's transaction so the links and the list never disagree.
 */
export async function setItemMerchants(
	tx: DbOrTx,
	shopItemId: string,
	merchantIds: readonly string[],
): Promise<string[]> {
	const wanted = [...new Set(merchantIds)]
	if (wanted.length > 0) {
		const found = await tx.orm.public.GrantCardMerchant.where(merchant => merchant.id.in(wanted))
			.select("id")
			.all()
		if (found.length !== wanted.length)
			throw new HttpError("VALIDATION_FAILED", "One of those merchants no longer exists. Reload and try again")
	}

	const current = await tx.orm.public.ShopItemGrantCardMerchant.where({ shopItemId }).select("merchantId").all()
	const have = new Set(current.map(link => link.merchantId))
	const want = new Set(wanted)
	for (const link of current) {
		if (!want.has(link.merchantId))
			await tx.orm.public.ShopItemGrantCardMerchant.where({ merchantId: link.merchantId, shopItemId }).delete()
	}
	for (const merchantId of wanted) {
		if (!have.has(merchantId)) await tx.orm.public.ShopItemGrantCardMerchant.create({ merchantId, shopItemId })
	}

	return syncItemMerchantIds(tx, shopItemId)
}

export interface MerchantInput {
	merchantIds?: readonly string[]
	name?: string
	sourceNote?: string
}

export async function createGrantCardMerchant(
	input: { merchantIds: readonly string[]; name: string; sourceNote: string },
	actor: Actor,
) {
	const slug = merchantSlug(input.name)
	const existing = await db.orm.public.GrantCardMerchant.whereUnique({ slug }).select("id").first()
	if (existing) throw new HttpError("CONFLICT", `A merchant called "${input.name}" already exists`)

	const merchant = await db.orm.public.GrantCardMerchant.create({
		merchantIds: [...new Set(input.merchantIds)],
		name: input.name,
		slug,
		sourceNote: input.sourceNote,
	})
	await logAudit({
		action: AuditAction.ADMIN_UPDATE_SHOP_ITEM,
		actorEmail: actor.email,
		actorId: actor.id,
		metadata: {
			after: { merchantIds: [...merchant.merchantIds], name: merchant.name },
			reason: "Grant card merchant created",
		},
		targetId: merchant.id,
		targetType: "GrantCardMerchant",
	})
	return merchant
}

/**
 * Edit a merchant. Its linked items are recomputed afterwards, so their card lists follow the new IDs at once. The slug stays put: it is how a merchant is found, whatever it is called.
 */
export async function updateGrantCardMerchant(id: string, input: MerchantInput, actor: Actor) {
	const before = await db.orm.public.GrantCardMerchant.whereUnique({ id }).first()
	if (!before) throw new HttpError("NOT_FOUND", "Merchant not found")

	const merchant = await db.transaction(async tx => {
		const updated = await tx.orm.public.GrantCardMerchant.where({ id }).update({
			...(input.name === undefined ? {} : { name: input.name }),
			...(input.sourceNote === undefined ? {} : { sourceNote: input.sourceNote }),
			...(input.merchantIds === undefined ? {} : { merchantIds: [...new Set(input.merchantIds)] }),
		})
		if (!updated) throw new HttpError("NOT_FOUND", "Merchant not found")
		const linked = await tx.orm.public.ShopItemGrantCardMerchant.where({ merchantId: id }).select("shopItemId").all()
		for (const link of linked) await syncItemMerchantIds(tx, link.shopItemId)
		return updated
	})

	await logAudit({
		action: AuditAction.ADMIN_UPDATE_SHOP_ITEM,
		actorEmail: actor.email,
		actorId: actor.id,
		metadata: {
			after: { merchantIds: [...merchant.merchantIds], name: merchant.name, sourceNote: merchant.sourceNote },
			before: { merchantIds: [...before.merchantIds], name: before.name, sourceNote: before.sourceNote },
		},
		targetId: id,
		targetType: "GrantCardMerchant",
	})
	return merchant
}

/** Only a merchant no item uses can go. A linked one is unlinked from its items first, so the lists never lose a merchant silently. */
export async function deleteGrantCardMerchant(id: string, actor: Actor) {
	const before = await db.orm.public.GrantCardMerchant.whereUnique({ id }).first()
	if (!before) throw new HttpError("NOT_FOUND", "Merchant not found")
	const linked = await db.orm.public.ShopItemGrantCardMerchant.where({ merchantId: id }).select("shopItemId").all()
	if (linked.length > 0)
		throw new HttpError("CONFLICT", `${before.name} is still linked to ${linked.length} item(s). Unlink it first`)

	await db.orm.public.GrantCardMerchant.where({ id }).delete()
	await logAudit({
		action: AuditAction.ADMIN_UPDATE_SHOP_ITEM,
		actorEmail: actor.email,
		actorId: actor.id,
		metadata: {
			before: { merchantIds: [...before.merchantIds], name: before.name },
			reason: "Grant card merchant deleted",
		},
		targetId: id,
		targetType: "GrantCardMerchant",
	})
}
