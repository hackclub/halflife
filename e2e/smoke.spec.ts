import { expect, test } from "./fixtures"

test("a signed-in participant lands on the trail", async ({ participant }) => {
	await participant.goto("/")

	await expect(participant).toHaveURL(/\/dashboard$/)
	await expect(participant).toHaveTitle("Dashboard · Half Life")
	await expect(participant.getByRole("link", { name: "Half Life home" }).first()).toBeVisible()
})
