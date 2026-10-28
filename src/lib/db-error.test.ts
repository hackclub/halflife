import { describe, expect, test } from "bun:test"
import { describeDatabaseError } from "@/lib/db-error"

/** The shape Prisma 8 gives a driver failure: `SqlConnectionError` around the error the socket threw. */
function connectionError(cause: Error): Error {
	return Object.assign(new Error(cause.message, { cause }), { kind: "sql_connection", transient: false })
}

/**
 * The one line a log gets instead of a stack.
 *
 * Pinned on the two failures this was written for – a refused connection to the database's port, and a server that restarted or failed over and terminated its clients – because the point is that the address and the reason survive into the log. A change that reverts to `console.error(err)` would print every pg internal per event, and one that loses the cause would drop the address.
 */
describe("describeDatabaseError", () => {
	test("names the address and says nothing is listening on it", () => {
		const cause = Object.assign(new Error("connect ECONNREFUSED 10.109.122.116:5432"), {
			code: "ECONNREFUSED",
			errno: -111,
			port: 5432,
			syscall: "connect",
		})

		expect(describeDatabaseError(connectionError(cause))).toBe(
			"connect ECONNREFUSED 10.109.122.116:5432 (ECONNREFUSED) – nothing is listening on that address",
		)
	})

	test("reads a pg FATAL, whose SQLSTATE is in code, as a restart rather than a fault", () => {
		const error = Object.assign(new Error("terminating connection due to administrator command"), {
			code: "57P01",
			file: "postgres.c",
			length: 116,
			routine: "ProcessInterrupts",
			severity: "FATAL",
		})

		expect(describeDatabaseError(error)).toBe(
			"terminating connection due to administrator command (57P01) – the server ended this connection, as it does on a restart or failover",
		)
	})

	test("turns a rejected password into the deployment fact it is", () => {
		const error = Object.assign(new Error('password authentication failed for user "postgres"'), {
			kind: "sql_query",
			sqlState: "28P01",
		})

		expect(describeDatabaseError(error)).toBe(
			'password authentication failed for user "postgres" (28P01) – Postgres rejected the password in DATABASE_URL',
		)
	})

	test("keeps an unrecognised code rather than inventing a meaning", () => {
		expect(describeDatabaseError(Object.assign(new Error("boom"), { code: "EWEIRD" }))).toBe("boom (EWEIRD)")
	})

	test("falls back to the outer error when there is no cause chain", () => {
		expect(describeDatabaseError(new Error("boom"))).toBe("boom")
		expect(describeDatabaseError("boom")).toBe("boom")
	})
})
