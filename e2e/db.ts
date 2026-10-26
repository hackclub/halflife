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

/** The persisted half of the onboarding state, read back rather than inferred from the modal closing. */
export async function readUser(id: string): Promise<E2eUserRow | null> {
	const { rows } = await pool.query(
		`select "hardwareExperience", "onboardingCompletedAt", "onboardingStep", timezone, "verificationStatus"
		from "user" where id = $1`,
		[id],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return (rows[0] as E2eUserRow | undefined) ?? null
}

export async function readProjects(userId: string): Promise<E2eProjectRow[]> {
	const { rows } = await pool.query(
		`select id, title, description, "requestedTier", "starterProjectId", theme, "designStatus"
		from theme_project
		where "userId" = $1 and "deletedAt" is null
		order by "createdAt" asc`,
		[userId],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return rows as E2eProjectRow[]
}

/**
 * One project on a chosen theme.
 *
 * Onboarding anchors to the participant's first project, which is normally the current week's. A test that needs the starter fork has to run in a week that has a starter, so it seeds the week-one PCB row rather than depending on the calendar.
 */
export async function seedProject(userId: string, theme = "PCB"): Promise<string> {
	const id = randomUUID()
	await pool.query(
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
		await pool.query(
			`insert into post (id, "userId", caption, "objectKey", status, "createdAt", "updatedAt")
			values ($1, $2, 'e2e reel', 'e2e/reel.mp4', 'PUBLISHED'::"PostStatus", now(), now())`,
			[id, userId],
		)

	await pool.query(
		`insert into post_comment (id, "postId", "userId", body, "createdAt", "updatedAt")
		values ($1, $2, $3, 'e2e comment', now(), now())`,
		[randomUUID(), postIds[0], userId],
	)

	return postIds
}

/** What a ban's bulk hide did to the member's reels and comments, read back from the rows rather than the card. */
export async function readModerationRows(userId: string): Promise<E2eModerationRows> {
	const [posts, comments] = await Promise.all([
		pool.query(
			`select
				count(*) filter (where "hiddenAt" is not null)::int as "postsHidden",
				count(*) filter (where status = 'PUBLISHED'::"PostStatus")::int as "postsPublished",
				count(*) filter (where "hiddenByBanAt" is not null)::int as "postsStamped"
			from post where "userId" = $1`,
			[userId],
		),
		pool.query(
			`select
				count(*) filter (where "hiddenAt" is not null)::int as "commentsHidden",
				count(*) filter (where "hiddenByBanAt" is not null)::int as "commentsStamped"
			from post_comment where "userId" = $1`,
			[userId],
		),
	])

	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	const postRow = posts.rows[0] as Pick<E2eModerationRows, "postsHidden" | "postsPublished" | "postsStamped">
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	const commentRow = comments.rows[0] as Pick<E2eModerationRows, "commentsHidden" | "commentsStamped">
	return { ...commentRow, ...postRow }
}

/** Coins in one bucket. The purchase debit is one row, so a sum is the balance the page shows. */
export async function readBalance(userId: string, bucket: "BANKED" | "SPENDABLE" = "SPENDABLE"): Promise<number> {
	const { rows } = await pool.query(
		`select coalesce(sum(amount), 0)::int as balance from ledger_entry where "userId" = $1 and bucket = $2::"CoinBucket"`,
		[userId, bucket],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return (rows[0] as { balance: number }).balance
}

export async function readShopOrders(userId: string): Promise<E2eShopOrderRow[]> {
	const { rows } = await pool.query(
		`select id, "shopItemId", quantity, "unitCredits", "totalCredits", status
		from shop_order where "userId" = $1
		order by "placedAt" asc`,
		[userId],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return rows as E2eShopOrderRow[]
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

	await pool.query(
		`insert into theme_project (
			id, "userId", theme, title, description, "designStatus", "buildStatus",
			"repoSyncEnabled", "createdAt", "updatedAt"
		) values (
			$1, $2, 'PCB'::"Theme", $3, 'A project waiting for design review.',
			'in_review'::"PhaseStatus", 'draft'::"PhaseStatus", false, now(), now()
		)`,
		[projectId, user.id, projectTitle],
	)

	await pool.query(
		`insert into phase_submission (id, "themeProjectId", phase, "submittedInWeek", "onTime", "createdAt")
		values ($1, $2, 'DESIGN'::"Phase", 1, true, now())`,
		[submissionId, projectId],
	)

	return { projectId, projectTitle, submissionId, user }
}

export async function readSubmission(id: string): Promise<E2eSubmissionRow | null> {
	const { rows } = await pool.query(
		`select id, "themeProjectId", phase, "resolvedAt", "resolvedResult", "createdAt"
		from phase_submission where id = $1`,
		[id],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return (rows[0] as E2eSubmissionRow | undefined) ?? null
}

export async function readSubmissionReviews(submissionId: string): Promise<E2eSubmissionReviewRow[]> {
	const { rows } = await pool.query(
		`select id, result, feedback, reason, "reviewerId"
		from submission_review where "submissionId" = $1
		order by "createdAt" desc`,
		[submissionId],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return rows as E2eSubmissionReviewRow[]
}

export async function readAudit(action: string): Promise<E2eAuditRow | null> {
	const { rows } = await pool.query(
		`select action, "actorEmail", metadata, "createdAt"
		from audit_log where action = $1::"AuditAction"
		order by "createdAt" desc limit 1`,
		[action],
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return (rows[0] as E2eAuditRow | undefined) ?? null
}

export async function readProgramSettings(): Promise<E2eProgramSettingsRow | null> {
	const { rows } = await pool.query(
		`select "programTimezone", "shopOpen", "submissionsOpen" from program_settings where id = 'singleton'`,
	)
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- e2e harness row; the SQL select defines this shape
	return (rows[0] as E2eProgramSettingsRow | undefined) ?? null
}

export async function closeDb(): Promise<void> {
	await pool.end()
}
