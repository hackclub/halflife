import { readAudit, readModerationRows, seedReelsWithComment } from "./db"
import { expect, test } from "./fixtures"
import { waitForHydration } from "./hydration"

/**
 * Suspension and ban, end to end: applied from the admin user page, felt by the participant's own browser, and recorded in the audit trail.
 *
 * The two penalties differ in exactly one observable way – a suspended member still reads and still sees their banner, a banned one loses the session – so the test drives both and checks the boundary rather than restating the implementation.
 *
 * Everything is written inside the test bodies rather than in helpers: this suite's transform is plain JavaScript, so a type annotation anywhere but a test callback's inferred parameters is a file that will not load.
 */
test("an admin suspends, then bans, a participant", async ({ admin, openAs }) => {
	const { page: participantPage, user } = await openAs({ onboarding: "complete" })
	// More than one row of each, so a bulk hide that updates a single row fails here instead of passing quietly.
	await seedReelsWithComment(user.id)

	await admin.goto(`/admin/users/${user.id}`)
	await expect(admin.getByRole("heading", { level: 1, name: "E2E Participant" })).toBeVisible()

	// ── Suspend ────────────────────────────────────────────────────────────────
	const reason = admin.getByLabel("Penalty reason")
	const form = admin.locator("form").filter({ has: reason })
	await waitForHydration(form)
	await reason.fill("e2e suspension")
	await admin.getByLabel("Suspend until").fill("2030-01-01T12:00")
	await form.getByRole("button", { name: "Suspend" }).click()
	await expect(admin.getByText(/Suspended until/)).toBeVisible({ timeout: 15_000 })

	// The member still signs in; the banner says what they can no longer do.
	await participantPage.goto("/reels")
	await expect(participantPage.getByText("Your account is suspended.")).toBeVisible()

	// A write is refused by the guard, not by whichever route body would have run next.
	const refused = await participantPage.request.put("/api/posts/does-not-exist/like", { data: { liked: true } })
	expect(refused.status()).toBe(403)
	expect(await refused.json()).toMatchObject({ error: { code: "ACCOUNT_SUSPENDED" } })

	// ── Lift the suspension ────────────────────────────────────────────────────
	await admin.goto(`/admin/users/${user.id}`)
	await waitForHydration(admin.getByRole("button", { name: "Lift suspension" }))
	await admin.getByRole("button", { name: "Lift suspension" }).click()
	await expect(admin.getByText("No penalty on record")).toBeVisible({ timeout: 15_000 })

	// ── Ban ────────────────────────────────────────────────────────────────────
	const banReason = admin.getByLabel("Penalty reason")
	await waitForHydration(banReason)
	await banReason.fill("e2e ban")
	await admin.locator("form").filter({ has: banReason }).getByRole("button", { name: "Ban" }).click()
	await expect(admin.getByText(/Banned since/)).toBeVisible({ timeout: 15_000 })
	expect(await readAudit("ADMIN_BAN_USER")).not.toBeNull()
	// The ban with "hide content" ticked takes every reel and comment, not the first one the filter happens to return.
	expect(await readModerationRows(user.id)).toMatchObject({
		commentsHidden: 1,
		commentsStamped: 1,
		postsHidden: 2,
		postsPublished: 0,
		postsStamped: 2,
	})

	// The advertisement is honest: the seeded session row is gone, so the member is signed out of the next page load.
	await participantPage.goto("/dashboard")
	await expect(participantPage).toHaveURL(/\/$/)

	// ── Lift the ban, restoring only what the ban itself hid ───────────────────
	await admin.goto(`/admin/users/${user.id}`)
	await waitForHydration(admin.getByRole("button", { name: "Lift ban" }))
	await admin.getByRole("button", { name: "Lift ban" }).click()
	await expect(admin.getByText("No penalty on record")).toBeVisible({ timeout: 15_000 })
	expect(await readModerationRows(user.id)).toMatchObject({
		commentsHidden: 0,
		commentsStamped: 0,
		postsHidden: 0,
		postsPublished: 2,
		postsStamped: 0,
	})
})

test("a suspended participant cannot spend, report or log work", async ({ admin, openAs }) => {
	const { page, user } = await openAs({ onboarding: "complete" })

	await admin.goto(`/admin/users/${user.id}`)
	const reason = admin.getByLabel("Penalty reason")
	const form = admin.locator("form").filter({ has: reason })
	await waitForHydration(form)
	await reason.fill("e2e suspension")
	await admin.getByLabel("Suspend until").fill("2030-01-01T12:00")
	await form.getByRole("button", { name: "Suspend" }).click()
	await expect(admin.getByText(/Suspended until/)).toBeVisible({ timeout: 15_000 })

	const attempts = [
		{ body: { hoursClaimed: 1, phase: "DESIGN", title: "x" }, url: "/api/projects/does-not-exist/sessions" },
		{ body: { itemId: "does-not-exist", quantity: 1 }, url: "/api/shop/orders" },
		{ body: { reason: "SPAM", targetId: "does-not-exist", targetType: "USER" }, url: "/api/reports" },
	]
	for (const attempt of attempts) {
		const refused = await page.request.post(attempt.url, { data: attempt.body })
		expect(refused.status()).toBe(403)
		expect(await refused.json()).toMatchObject({ error: { code: "ACCOUNT_SUSPENDED" } })
	}
})
