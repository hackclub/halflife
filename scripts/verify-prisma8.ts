import "dotenv/config"
import db from "@/lib/prisma8"

const { users } = await db.orm.public.User.aggregate(a => ({ users: a.count() }))
console.log("user count:", users)

const recent = await db.orm.public.User.select("id", "name", "createdAt")
	.orderBy(u => u.createdAt.desc())
	.limit(2)
	.all()
console.log("recent users:", recent)
console.log("createdAt type:", typeof recent[0]?.createdAt)

const project = await db.orm.public.ThemeProject.select("id", "title")
	.include("user", u => u.select("id", "name"))
	.orderBy(p => p.createdAt.desc())
	.limit(1)
	.all()
console.log("project + user:", project)

// The exact queries behind the migrated /admin/shop page.
const items = await db.orm.public.ShopItem.orderBy([i => i.sortOrder.asc(), i => i.name.asc()]).all()
const regions = await db.orm.public.ShopRegion.select("id", "name", "active")
	.include("prices", prices => prices.count())
	.orderBy([r => r.sortOrder.asc(), r => r.name.asc()])
	.all()
console.log("shop items:", items.length)
console.log("shop regions:", regions)
console.log("region override count type:", typeof regions[0]?.prices)

await db.close()
