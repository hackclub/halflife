import { z } from "zod"
import { fail, ok, parseBody, withRoute } from "@/lib/api"
import { AuditAction, logAudit } from "@/lib/audit"
import { requirePermission } from "@/lib/guards"
import { dollars } from "@/lib/money"
import { Permission } from "@/lib/permissions"
import prisma from "@/lib/prisma"
import { sanitize } from "@/lib/sanitize"
import { parseShopCsv } from "@/lib/shop-csv"

export const dynamic = "force-dynamic"

/** Half a megabyte is thousands of rows; the row cap in shop-csv bites first. */
const importSchema = z.object({ csv: z.string().min(1).max(500_000) }).strict()

/**
 * Add shop items from a CSV, all or nothing.
 *
 * A file with any bad row, or any slug that already exists, imports nothing and says which lines to fix – the same refusal the single-item form gives, once per line. Existing items are never touched: changing one is what its own page is for.
 */
export const POST = withRoute(async (req: Request) => {
	const gate = await requirePermission(Permission.MANAGE_SHOP)
	if (gate.error) return gate.error

	const parsed = await parseBody(req, importSchema)
	if (parsed.error) return parsed.error

	const { items, problems } = parseShopCsv(parsed.data.csv)
	if (problems.length > 0)
		return fail("VALIDATION_FAILED", "Nothing was imported. Fix these and try again.", { problems })

	const taken = await prisma.shopItem.findMany({
		select: { id: true },
		where: { id: { in: items.map(i => i.id) } },
	})
	if (taken.length > 0)
		return fail("CONFLICT", "Nothing was imported. These slugs already exist.", {
			problems: taken.map(t => ({ line: 0, message: `Slug "${t.id}" already exists. Edit it from its own page.` })),
		})

	const data = items.map(item =>
		Object.assign({}, item, {
			costUsd: dollars(item.costUsd ?? null),
			description: sanitize(item.description),
			imageUrl: item.imageUrl ?? null,
			name: sanitize(item.name),
		}),
	)
	// createMany is one statement, so a slug added in the meantime fails the whole batch rather than leaving half of it behind.
	await prisma.shopItem.createMany({ data })

	await Promise.all(
		data.map(item =>
			logAudit({
				action: AuditAction.ADMIN_CREATE_SHOP_ITEM,
				actorEmail: gate.user.email,
				actorId: gate.user.id,
				metadata: { after: { costUsd: item.costUsd, name: item.name, priceCredits: item.priceCredits }, via: "csv" },
				targetId: item.id,
				targetType: "ShopItem",
			}),
		),
	)

	return ok({ created: data.length, ids: data.map(i => i.id) }, { status: 201 })
})
