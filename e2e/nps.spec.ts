import { expect, test } from "./fixtures"

test("the NPS follow-up keeps the saved score and cannot be closed until an answer is sent", async ({ openAs }) => {
	const { page } = await openAs({ onboarding: "complete" })
	await page.route("**/api/me/nps", route => route.fulfill({ json: { score: 7, textsDone: false } }))

	let submitted = ""
	await page.route("**/api/me/nps/texts", async route => {
		submitted = route.request().postData() ?? ""
		await route.fulfill({ json: { saved: true } })
	})

	await page.goto("/dashboard")

	const dialog = page.getByRole("dialog", { name: "Tell us more" })
	await expect(dialog).toBeVisible()
	await expect(dialog.getByRole("radio", { name: "7" })).toHaveAttribute("aria-checked", "true")

	const send = dialog.getByRole("button", { name: "Send feedback" })
	await expect(send).toBeDisabled()

	// The follow-up is the second gate: Escape does nothing until an answer is sent.
	await page.keyboard.press("Escape")
	await expect(dialog).toBeVisible()

	await dialog.getByRole("radio", { name: "9" }).click()
	await dialog.getByLabel("What is going well?").fill("The trail")
	await expect(send).toBeEnabled()
	await send.click()

	await expect(dialog).toHaveCount(0)
	expect(JSON.parse(submitted)).toMatchObject({ howDoingWell: "The trail", howLikelyRecommend: 9 })
})
