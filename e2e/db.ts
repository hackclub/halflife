import { randomUUID } from "node:crypto"
import { SQL } from "bun"
import { bunSqlUrl } from "@/lib/db-url"
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

export interface E2eProjectRow {
	description: string | null
	designStatus: string
	id: string
	requestedTier: number | null
	starterProjectId: string | null
	theme: string
	title: string
}

export interface E2eShopOrderRow {
	id: string
	quantity: number
	shopItemId: string
	status: string
	totalCredits: number
	unitCredits: number
}

export interface E2eUserRow {
	hardwareExperience: string | null
	onboardingCompletedAt: Date | null
	onboardingStep: number
	timezone: string | null
	verificationStatus: string | null
}

export interface E2eSubmissionRow {
	createdAt: Date
	id: string
	phase: string
	resolvedAt: Date | null
	resolvedResult: string | null
	themeProjectId: string
}

export interface E2eSubmissionReviewRow {
	feedback: string
	id: string
	reason: string | null
	result: string
	reviewerId: string | null
}

export interface E2eAuditRow {
	action: string
	actorEmail: string | null
	createdAt: Date
	metadata: unknown
}

export interface E2eModerationRows {
	commentsHidden: number
	commentsStamped: number
	postsHidden: number
	postsPublished: number
	postsStamped: number
}

export interface E2eProgramSettingsRow {
	programTimezone: string
	shopOpen: boolean
	submissionsOpen: boolean
}

const ONBOARDING_COMPLETE_STEP = 7

const pool = new SQL(bunSqlUrl(e2eDatabaseUrl))

/** The format the app writes into `timestamp(3)` columns. */
const dbTimestamp = (date: Date): string => date.toISOString().replace("T", " ").replace("Z", "")

/**
 * A same-realm copy of a result set.
 *
 * Bun returns rows as an array whose prototype is `SQLResultArray`, not `Array.prototype`, and Playwright's `toEqual` throws a `TypeError` on one instead of reporting a diff. Copying keeps an empty result comparable to a literal `[]`.
 */
const plainRows = <T>(rows: T[]): T[] => Array.from(rows)

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

	await pool.unsafe(
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

	await pool.unsafe(
		`insert into session (id, token, "expiresAt", "userId", "createdAt", "updatedAt", "ipAddress", "userAgent")
		values ($1, $2, now() + interval '7 days', $3, now(), now(), '127.0.0.1', 'e2e')`,
		[randomUUID(), token, id],
	)

	if (options.role)
		await pool.unsafe(`insert into user_role (id, "userId", role, "grantedBy") values ($1, $2, $3::"Role", 'e2e')`, [
			randomUUID(),
			id,
			options.role,
		])

	if (options.coins)
		await pool.unsafe(
			`insert into ledger_entry (
				id, "userId", kind, bucket, amount, "balanceBefore", "balanceAfter", note, "createdAt"
			) values ($1, $2, 'ADMIN_ADJUSTMENT'::"LedgerKind", 'SPENDABLE'::"CoinBucket", $3, 0, $3, 'e2e seed', now())`,
			[randomUUID(), id, options.coins],
		)

	return { email, id, token }
}

/** Remove a user and everything cascading from it. */
export async function deleteUser(id: string): Promise<void> {
	await pool.unsafe(`delete from "user" where id = $1`, [id])
}

/** The persisted half of the onboarding state, read back rather than inferred from the modal closing. */
export async function readUser(id: string): Promise<E2eUserRow | null> {
	const rows = await pool.unsafe<E2eUserRow[]>(
		`select "hardwareExperience", "onboardingCompletedAt", "onboardingStep", timezone, "verificationStatus"
		from "user" where id = $1`,
		[id],
	)
	return rows[0] ?? null
}

export async function readProjects(userId: string): Promise<E2eProjectRow[]> {
	const rows = await pool.unsafe<E2eProjectRow[]>(
		`select id, title, description, "requestedTier", "starterProjectId", theme, "designStatus"
		from theme_project
		where "userId" = $1 and "deletedAt" is null
		order by "createdAt" asc`,
		[userId],
	)
	return plainRows(rows)
}

/**
 * One project on a chosen theme.
 *
 * Onboarding anchors to the participant's first project, which is normally the current week's. A test that needs the starter fork has to run in a week that has a starter, so it seeds the week-one PCB row rather than depending on the calendar.
 */
export async function seedProject(userId: string, theme = "PCB"): Promise<string> {
	const id = randomUUID()
	await pool.unsafe(
		`insert into theme_project (id, "userId", theme, title, "createdAt", "updatedAt")
		values ($1, $2, $3::"Theme", $4, now(), now())`,
		[id, userId, theme, theme],
	)
	return id
}

/**
 * Two published reels and one comment by the same member.
 *
 * Two reels rather than one on purpose: a bulk hide that quietly updates only a single row still passes with one post to hide, which is exactly the bug this seeds against.
 */
export async function seedReelsWithComment(userId: string): Promise<string[]> {
	const postIds = [randomUUID(), randomUUID()]
	for (const id of postIds)
		await pool.unsafe(
			`insert into post (id, "userId", caption, "objectKey", status, "createdAt", "updatedAt")
			values ($1, $2, 'e2e reel', 'e2e/reel.mp4', 'PUBLISHED'::"PostStatus", now(), now())`,
			[id, userId],
		)

	await pool.unsafe(
		`insert into post_comment (id, "postId", "userId", body, "createdAt", "updatedAt")
		values ($1, $2, $3, 'e2e comment', now(), now())`,
		[randomUUID(), postIds[0], userId],
	)

	return postIds
}

/** What a ban's bulk hide did to the member's reels and comments, read back from the rows rather than the card. */
export async function readModerationRows(userId: string): Promise<E2eModerationRows> {
	const [posts, comments] = await Promise.all([
		pool.unsafe<Pick<E2eModerationRows, "postsHidden" | "postsPublished" | "postsStamped">[]>(
			`select
				count(*) filter (where "hiddenAt" is not null)::int as "postsHidden",
				count(*) filter (where status = 'PUBLISHED'::"PostStatus")::int as "postsPublished",
				count(*) filter (where "hiddenByBanAt" is not null)::int as "postsStamped"
			from post where "userId" = $1`,
			[userId],
		),
		pool.unsafe<Pick<E2eModerationRows, "commentsHidden" | "commentsStamped">[]>(
			`select
				count(*) filter (where "hiddenAt" is not null)::int as "commentsHidden",
				count(*) filter (where "hiddenByBanAt" is not null)::int as "commentsStamped"
			from post_comment where "userId" = $1`,
			[userId],
		),
	])

	const postRow = posts[0] ?? { postsHidden: 0, postsPublished: 0, postsStamped: 0 }
	const commentRow = comments[0] ?? { commentsHidden: 0, commentsStamped: 0 }
	return { ...commentRow, ...postRow }
}

/** Coins in one bucket. The purchase debit is one row, so a sum is the balance the page shows. */
export async function readBalance(userId: string, bucket: "BANKED" | "SPENDABLE" = "SPENDABLE"): Promise<number> {
	const rows = await pool.unsafe<{ balance: number }[]>(
		`select coalesce(sum(amount), 0)::int as balance from ledger_entry where "userId" = $1 and bucket = $2::"CoinBucket"`,
		[userId, bucket],
	)
	return rows[0]?.balance ?? 0
}

export async function readShopOrders(userId: string): Promise<E2eShopOrderRow[]> {
	const rows = await pool.unsafe<E2eShopOrderRow[]>(
		`select id, "shopItemId", quantity, "unitCredits", "totalCredits", status
		from shop_order where "userId" = $1
		order by "placedAt" asc`,
		[userId],
	)
	return plainRows(rows)
}

/**
 * A participant with one design submission waiting for review.
 *
 * The row carries only what the queue, detail page and rejection path read: no sessions, links or reels, so the reviewer's computed hours are zero and a rejection needs no tier or hours decision.
 */
export async function seedSubmission(): Promise<{
	projectId: string
	projectTitle: string
	submissionId: string
	user: SeededUser
}> {
	const user = await seedUser({ onboarding: "complete" })
	const projectId = randomUUID()
	const submissionId = randomUUID()
	const projectTitle = `E2E Review Project ${projectId.slice(0, 8)}`

	await pool.unsafe(
		`insert into theme_project (
			id, "userId", theme, title, description, "designStatus", "buildStatus",
			"repoSyncEnabled", "createdAt", "updatedAt"
		) values (
			$1, $2, 'PCB'::"Theme", $3, 'A project waiting for design review.',
			'in_review'::"PhaseStatus", 'draft'::"PhaseStatus", false, now(), now()
		)`,
		[projectId, user.id, projectTitle],
	)

	await pool.unsafe(
		`insert into phase_submission (id, "themeProjectId", phase, "submittedInWeek", "onTime", "createdAt")
		values ($1, $2, 'DESIGN'::"Phase", 1, true, now())`,
		[submissionId, projectId],
	)

	return { projectId, projectTitle, submissionId, user }
}

export async function readSubmission(id: string): Promise<E2eSubmissionRow | null> {
	const rows = await pool.unsafe<E2eSubmissionRow[]>(
		`select id, "themeProjectId", phase, "resolvedAt", "resolvedResult", "createdAt"
		from phase_submission where id = $1`,
		[id],
	)
	return rows[0] ?? null
}

export async function readSubmissionReviews(submissionId: string): Promise<E2eSubmissionReviewRow[]> {
	const rows = await pool.unsafe<E2eSubmissionReviewRow[]>(
		`select id, result, feedback, reason, "reviewerId"
		from submission_review where "submissionId" = $1
		order by "createdAt" desc`,
		[submissionId],
	)
	return plainRows(rows)
}

export async function readAudit(action: string): Promise<E2eAuditRow | null> {
	const rows = await pool.unsafe<E2eAuditRow[]>(
		`select action, "actorEmail", metadata, "createdAt"
		from audit_log where action = $1::"AuditAction"
		order by "createdAt" desc limit 1`,
		[action],
	)
	return rows[0] ?? null
}

export async function readProgramSettings(): Promise<E2eProgramSettingsRow | null> {
	const rows = await pool.unsafe<E2eProgramSettingsRow[]>(
		`select "programTimezone", "shopOpen", "submissionsOpen" from program_settings where id = 'singleton'`,
	)
	return rows[0] ?? null
}

export async function closeDb(): Promise<void> {
	await pool.close()
}
