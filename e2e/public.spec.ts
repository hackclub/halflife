import { e2eBaseUrl } from "./env"
import { expect, test } from "./fixtures"

test("a signed-out visitor gets the landing page", async ({ page }) => {
	await page.goto("/")

	await expect(page).toHaveTitle("Half Life by Hack Club")
	await expect(page.getByPlaceholder("email address").first()).toBeVisible()
})

test("the login page offers Hack Club sign-in", async ({ page }) => {
	await page.goto("/login")

	await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible()
	await expect(page.getByRole("button", { name: "Continue with Hack Club" })).toBeVisible()
})

test("the health endpoint reaches the database", async ({ request }) => {
	const response = await request.get(`${e2eBaseUrl}/api/health`)

	expect(response.status()).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
})
