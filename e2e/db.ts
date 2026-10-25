import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { e2eDatabaseUrl } from "./env"

/**
 * Users, roles and sessions created straight in Postgres.
 *
 * The app has no test login route and this suite must not add one: a backdoor in production is a worse trade than a fixture that knows the schema. The real risk is schema drift, so every insert here is kept to the handful of columns a page actually needs; the signed-in smoke test is what catches a rename.
 */

export type E2eRole = "ADMIN" | "AUDITOR" | "FULFILLER" | "REVIEWER"

export interface SeedUserOptions {
	/** Spendable coins granted as one ledger entry. */
	coins?: number
	/** A completed participant skips the onboarding overlay; a new one starts at step 0. */
	onboarding?: "complete" | "new"
	role?: E2eRole | null
	/** An unverified account is useful for guarding flows; most tests want verified. */
	verified?: boolean
}

export interface SeededUser {
	email: string
	id: string
	token: string
}

const ONBOARDING_COMPLETE_STEP = 7

const pool = new Pool({ connectionString: e2eDatabaseUrl })

/** The format the app writes into `timestamp(3)` columns. */
const dbTimestamp = (date: Date): string => date.toISOString().replace("T", " ").replace("Z", "")

/**
 * Insert one participant and one live session. The returned token is the raw token; `sessionCookie` signs it.
 *
 * Every row a test creates gets its own user, so tests can run in any order against one database without sharing state.
 */
export async function seedUser(options: SeedUserOptions = {}): Promise<SeededUser> {
	const id = randomUUID()
	const token = `${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`
	const email = `e2e-${id}@example.test`
	const complete = (options.onboarding ?? "complete") === "complete"
	const verified = options.verified ?? true
	const now = dbTimestamp(new Date())

	await pool.query(
		`insert into "user" (
			id, email, name, "emailVerified", "verificationStatus", "onboardingStep",
			"onboardingCompletedAt", "joinedProgramAt", "hardwareExperience", "participantGoal",
			timezone, "createdAt", "updatedAt"
		) values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, 'UTC', $10, $10)`,
		[
			id,
			email,
			complete ? "E2E Participant" : "E2E Newcomer",
			verified,
			verified ? "verified" : "pending",
			complete ? ONBOARDING_COMPLETE_STEP : 0,
			complete ? now : null,
			complete ? "A_LITTLE" : null,
			complete ? "PRINTER" : null,
			now,
		],
	)

	await pool.query(
		`insert into session (id, token, "expiresAt", "userId", "createdAt", "updatedAt", "ipAddress", "userAgent")
		values ($1, $2, now() + interval '7 days', $3, now(), now(), '127.0.0.1', 'e2e')`,
		[randomUUID(), token, id],
	)

	if (options.role)
		await pool.query(`insert into user_role (id, "userId", role, "grantedBy") values ($1, $2, $3::"Role", 'e2e')`, [
			randomUUID(),
			id,
			options.role,
		])

	if (options.coins)
		await pool.query(
			`insert into ledger_entry (
				id, "userId", kind, bucket, amount, "balanceBefore", "balanceAfter", note, "createdAt"
			) values ($1, $2, 'ADMIN_ADJUSTMENT'::"LedgerKind", 'SPENDABLE'::"CoinBucket", $3, 0, $3, 'e2e seed', now())`,
			[randomUUID(), id, options.coins],
		)

	return { email, id, token }
}

/** Remove a user and everything cascading from it. */
export async function deleteUser(id: string): Promise<void> {
	await pool.query(`delete from "user" where id = $1`, [id])
}

export async function closeDb(): Promise<void> {
	await pool.end()
}
