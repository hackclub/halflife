import "dotenv/config"
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config"
import { definePrismaConfig } from "prisma/config"

// Prisma 8 config: the contract in prisma/contract.prisma is the schema of record.
export default definePrismaConfig({
	orm: definePostgresConfig({
		contract: "prisma/contract.prisma",
		db: { connection: process.env.DATABASE_URL },
		migrations: { dir: "migrations" },
		output: "src/app/generated/prisma8",
	}),
})
