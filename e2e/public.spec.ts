import { e2eBaseUrl } from "./env"
import { expect, test } from "./fixtures"

test("a signed-out visitor gets the landing page", async ({ page }) => {
	await page.goto("/")

	await expect(page).toHaveTitle("Half Life by Hack Club")
	await expect(page.getByPlaceholder("email address").first()).toBeVisible()
})

test("a stale /login link lands on the landing page", async ({ page }) => {
	await page.goto("/login")

	await expect(page).toHaveURL(`${e2eBaseUrl}/`)
	await expect(page).toHaveTitle("Half Life by Hack Club")
	await expect(page.getByRole("link", { name: "log in" })).toBeVisible()
})

test("the health endpoint reaches the database", async ({ request }) => {
	const response = await request.get(`${e2eBaseUrl}/api/health`)

	expect(response.status()).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
})
