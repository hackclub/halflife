import { expect, test } from "./fixtures"

test("a signed-in participant lands on the trail", async ({ participant }) => {
	await participant.goto("/")

	await expect(participant).toHaveURL(/\/dashboard$/)
	await expect(participant).toHaveTitle("Half Life: become a hardware expert in 10 weeks")
	await expect(participant.getByRole("link", { name: "Half Life home" }).first()).toBeVisible()
})
