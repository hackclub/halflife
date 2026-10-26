import { sessionCookieName } from "./auth"
import { e2eBaseUrl } from "./env"
import { expect, test } from "./fixtures"

const landingUrl = `${e2eBaseUrl}/`

test("a signed-out visitor is sent to the landing page", async ({ page }) => {
	await page.goto("/dashboard")

	await expect(page).toHaveURL(landingUrl)
	await expect(page.getByPlaceholder("email address").first()).toBeVisible()
})

test("a forged session cookie is rejected and cleared", async ({ page }) => {
	await page.context().addCookies([
		{
			domain: new URL(e2eBaseUrl).hostname,
			expires: Math.floor(Date.now() / 1000) + 60,
			httpOnly: true,
			name: sessionCookieName,
			path: "/",
			sameSite: "Lax",
			secure: true,
			value: "forged-token.not-a-valid-signature",
		},
	])

	await page.goto("/dashboard")

	await expect(page).toHaveURL(landingUrl)
	const cookies = await page.context().cookies()
	expect(cookies.find(cookie => cookie.name === sessionCookieName)).toBeUndefined()
})

test("a participant cannot reach staff pages", async ({ participant }) => {
	for (const path of ["/admin", "/review"]) {
		const response = await participant.goto(path)
		expect(response?.status()).toBe(404)
	}
})

test("an admin sees the admin overview", async ({ admin }) => {
	const response = await admin.goto("/admin")

	expect(response?.status()).toBe(200)
	await expect(admin.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible()
})

test("a reviewer sees the review queue", async ({ reviewer }) => {
	const response = await reviewer.goto("/review")

	expect(response?.status()).toBe(200)
	await expect(reviewer.getByRole("heading", { level: 1, name: "Review queue" })).toBeVisible()
})

test("a participant can sign out", async ({ participant }) => {
	await participant.goto("/dashboard")
	await participant.getByRole("button", { name: "Log out" }).click()

	await expect(participant).toHaveURL(landingUrl)

	// The guard must agree, not just the client-side navigation.
	await participant.goto("/dashboard")
	await expect(participant).toHaveURL(landingUrl)
})
