import { messageOf } from "@/lib/errors"
import { isRecord } from "@/lib/unknown"

/** What the drivers' transport codes mean, so a log line says why instead of repeating the code. */
const CONNECTION_CODE_MEANINGS: { [_: string]: string } = {
	EAI_AGAIN: "the database hostname did not resolve in time",
	ECONNREFUSED: "nothing is listening on that address",
	ECONNRESET: "the connection was reset before the database answered",
	EHOSTUNREACH: "the database host cannot be reached from here",
	ENETUNREACH: "no route to the database's network",
	ENOTFOUND: "the database hostname does not resolve",
	ETIMEDOUT: "the database did not answer in time",
}

/** The SQLSTATEs worth spelling out: each is a deployment fact rather than a broken query. */
const SQL_STATE_MEANINGS: { [_: string]: string } = {
	"3D000": "the database in DATABASE_URL does not exist",
	"28P01": "Postgres rejected the password in DATABASE_URL",
	// Issued to every client when the server is shut down, restarted or failed over. A connection lost to one of these is expected to be replaced, not investigated.
	"57P01": "the server ended this connection, as it does on a restart or failover",
	"57P02": "the server crashed and closed this connection",
	"57P03": "Postgres is starting up and cannot accept connections yet",
	"28000": "Postgres refused this user",
	"53300": "Postgres has no connection slots left",
}

function stringField(value: unknown, key: string): string | undefined {
	return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined
}

/** The innermost `cause`, where the driver keeps the fact and the wrappers above it keep only the category. */
function innermostCause(error: unknown): unknown {
	let current = error
	for (let depth = 0; depth < 8; depth++) {
		const cause: unknown = isRecord(current) ? current.cause : undefined
		if (!isRecord(cause)) break
		current = cause
	}
	return current
}

/**
 * `pg` puts the SQLSTATE in `code`; Prisma puts it in `sqlState` and leaves `code` to transport failures. Both maps are checked for both fields so neither driver's shape has to be known by the caller.
 */
function meaningOf(code: string | undefined): string | undefined {
	if (code === undefined) return undefined
	return CONNECTION_CODE_MEANINGS[code] ?? SQL_STATE_MEANINGS[code]
}

/**
 * One line naming a database failure and, when the cause has a known answer, what it means.
 *
 * Prisma 8 wraps a driver failure in `SqlConnectionError`, whose own message repeats the driver's, and a stack from a production build points into a minified chunk. Neither tells an operator what the code does: `ECONNREFUSED` to the database's port is nothing listening, `28P01` is the wrong password in `DATABASE_URL`, `3D000` is a database that does not exist, and `57P01` is the server restarting or failing over. This says so, so a log answers "is the database down, is the deployment pointed somewhere wrong, or was that just a restart?" in one line.
 */
export function describeDatabaseError(error: unknown): string {
	const root = innermostCause(error)
	const message = (root instanceof Error ? root.message : stringField(root, "message")) || messageOf(error)
	const code = stringField(root, "code") ?? stringField(error, "code")
	const sqlState = stringField(error, "sqlState") ?? stringField(root, "sqlState")
	const label = code ?? sqlState
	const meaning = meaningOf(code) ?? meaningOf(sqlState)
	return [message, label && `(${label})`, meaning && `– ${meaning}`].filter(Boolean).join(" ")
}
