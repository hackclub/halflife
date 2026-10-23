import "dotenv/config"
import { defineConfig as definePostgresConfig } from "@prisma/orm-postgres/config"
import { definePrismaConfig } from "prisma/config"

// Prisma 8 config. Prisma 7 keeps running on prisma7.config.ts while routes move over.
export default definePrismaConfig({
	orm: definePostgresConfig({
		contract: "prisma8/contract.prisma",
		db: { connection: process.env.DATABASE_URL },
		output: "src/app/generated/prisma8",
	}),
})
