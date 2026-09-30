import "dotenv/config"
import { defineConfig } from "prisma/config"

const PLACEHOLDER = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

// `prisma migrate diff --from-migrations` needs a shadow database, but
// `prisma migrate deploy` REFUSES to run when the shadow URL equals the main
// one — which would crashloop every production pod at boot. So it is only set
// when SHADOW_DATABASE_URL is explicitly provided, which is CI and nowhere else.
const shadowDatabaseUrl = process.env.SHADOW_DATABASE_URL

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: {
    // Prisma 7 takes the CLI's connection URL from here rather than the schema.
    // The placeholder keeps `prisma validate` and `prisma generate` working in a
    // container build, where no database exists.
    url: process.env.DATABASE_URL ?? PLACEHOLDER,
    ...(shadowDatabaseUrl ? { shadowDatabaseUrl } : {}),
  },
})
