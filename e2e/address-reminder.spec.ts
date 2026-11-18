import { expect, test } from "./fixtures"

const DIALOG = "We can't ship your parts yet"

test("the address reminder is closeable, and comes back once its hour has passed", async ({ openAs }) => {
	const { page } = await openAs({ onboarding: "complete" })
	// The dashboard's NPS prompt would rightfully own the screen first; this test is about the reminder behind it.
	await page.route("**/api/me/nps", route =>
		route.fulfill({ json: { score: null, skipped: "unconfigured", textsDone: true } }),
	)
	await page.route("**/api/me/shipping-address", route => route.fulfill({ json: { needed: true } }))

	await page.goto("/dashboard")

	const dialog = page.getByRole("dialog", { name: DIALOG })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("link", { name: "Add my address" })).toHaveAttribute(
		"href",
		"https://auth.hackclub.com/addresses",
	)

	// Unlike the NPS prompt, closing works and is remembered.
	await dialog.getByRole("button", { name: "Remind me later" }).click()
	await expect(dialog).toHaveCount(0)

	await page.reload()
	await expect(page.getByRole("dialog", { name: DIALOG })).toHaveCount(0)

	// Move the dismissal beyond the snooze window, as an hour on the page would.
	await page.evaluate(() =>
		localStorage.setItem("halflife.address-reminder.dismissed-at", String(Date.now() - 61 * 60 * 1000)),
	)
	await page.reload()
	await expect(page.getByRole("dialog", { name: DIALOG })).toBeVisible()
})

test("no reminder when the address is on file", async ({ openAs }) => {
	const { page } = await openAs({ onboarding: "complete" })
	await page.route("**/api/me/nps", route =>
		route.fulfill({ json: { score: null, skipped: "unconfigured", textsDone: true } }),
	)
	await page.route("**/api/me/shipping-address", route => route.fulfill({ json: { needed: false } }))

	await page.goto("/dashboard")
	await expect(page.getByRole("dialog", { name: DIALOG })).toHaveCount(0)
})
