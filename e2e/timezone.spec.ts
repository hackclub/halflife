import { readUser } from "./db"
import { expect, test } from "./fixtures"

test("the browser timezone is captured into the account", async ({ openAs }) => {
	const { page, user } = await openAs({ timezoneId: "America/New_York" })
	await page.goto("/dashboard")

	await expect
		.poll(async () => (await readUser(user.id))?.timezone ?? null, { timeout: 15_000 })
		.toBe("America/New_York")
})
