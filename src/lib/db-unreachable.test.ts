import { describe, expect, test } from "bun:test"
import { describeUnreachableDatabase, isDatabaseUnreachable } from "@/lib/db-error"

/** The shape Prisma 8 gives a refused connection: `SqlConnectionError` around the socket's own error. */
function refused(address: string, port: number): Error {
	const cause = Object.assign(new Error(`connect ECONNREFUSED ${address}:${port}`), {
		address,
		code: "ECONNREFUSED",
		errno: -111,
		port,
		syscall: "connect",
	})
	return Object.assign(new Error(cause.message, { cause }), { kind: "sql_connection", transient: false })
}

describe("isDatabaseUnreachable", () => {
	test("counts a refused connection as the database not answering", () => {
		expect(isDatabaseUnreachable(refused("127.0.0.1", 5432))).toBe(true)
	})

	test("leaves a refused credential or a restart to the existing describer", () => {
		const auth = Object.assign(new Error("password authentication failed"), { sqlState: "28P01" })
		const restart = Object.assign(new Error("terminating connection"), { code: "57P01" })
		expect(isDatabaseUnreachable(auth)).toBe(false)
		expect(isDatabaseUnreachable(restart)).toBe(false)
	})
})

describe("describeUnreachableDatabase", () => {
	test("names the address, what the refusal means, and what to check", () => {
		expect(describeUnreachableDatabase(refused("127.0.0.1", 5432))).toBe(
			"Half Life cannot reach its database at 127.0.0.1:5432: nothing is listening on that address (ECONNREFUSED). Check the database is running and that DATABASE_URL points at it.",
		)
	})

	test("leaves the address out when the socket did not record one", () => {
		const error = Object.assign(new Error("getaddrinfo ENOTFOUND db"), { code: "ENOTFOUND" })
		expect(describeUnreachableDatabase(error)).toBe(
			"Half Life cannot reach its database: the database hostname does not resolve (ENOTFOUND). Check the database is running and that DATABASE_URL points at it.",
		)
	})
})
