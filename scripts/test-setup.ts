import { mock } from "bun:test"

/**
 * Give tests a database URL they never connect with.
 *
 * Importing a module that reaches `lib/prisma8` builds the client even when the test only exercises a pure function, and the client refuses to exist without a URL. The connection pool is lazy, so this placeholder opens nothing; CI has no `.env`, and that is where the import used to fail the whole file before a single test ran. A real URL, when a developer has one, is left alone.
 */
if (!process.env.DATABASE_URL)
	process.env.DATABASE_URL = "postgresql://placeholder:placeholder@localhost:5432/placeholder"

/**
 * Resolve `server-only` the way Next does for server code.
 *
 * The package exists to make an accidental client import a build error: its default entry throws on import, and the `react-server` condition points at an empty module instead. Tests import server modules for their logic all the time, so without the condition every one of them fails before a single assertion runs. The `test` script passes `--conditions=react-server`; this preload makes a bare `bun test` do the same.
 */
await mock.module("server-only", () => ({}))
