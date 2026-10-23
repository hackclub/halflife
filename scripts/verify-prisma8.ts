import "dotenv/config"
import postgres from "@prisma/orm-postgres/runtime"
import { contractFromJson } from "@prisma/orm-postgres/static"
import type { Contract } from "../generated/prisma8/contract.d"
import contractJson from "../generated/prisma8/contract.json" with { type: "json" }

const contract = contractFromJson<Contract>(contractJson)
const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error("DATABASE_URL is not set")
const db = postgres({ contract, url: connectionString })

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

await db.close()
