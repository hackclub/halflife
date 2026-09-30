import "server-only"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "@/app/generated/prisma/client"

// Cached on globalThis so Next's dev-mode module reloading doesn't open a new
// connection pool on every edit until Postgres refuses connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * Only ever used while `next build` imports this module for static analysis
 * on a machine with no database. A running server that reaches this line
 * without DATABASE_URL throws instead of booting and 500ing every request.
 */
const BUILD_TIME_DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error("DATABASE_URL is not set")
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: connectionString ?? BUILD_TIME_DATABASE_URL,
      // pg's default closes an idle connection after 10 seconds, and opening
      // one to this database is a TLS handshake that took ~900ms from a dev
      // machine — so any page opened after a short pause paid it before its
      // first query ran. Kept for 5 minutes, a warm connection is reused and
      // the layout's queries take ~115ms instead of ~1s.
      idleTimeoutMillis: 300_000,
      // A bound per process, well under the database's connection limit.
      max: 10,
    }),
  })
}

const prisma = globalForPrisma.prisma ?? createClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

export default prisma
export type { PrismaClient }
