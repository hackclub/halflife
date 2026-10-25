import { expect, type Page } from "@playwright/test"

export const experienceHeading = /have you built hardware before/i
export const projectHeading = /make your first project/i
export const tierHeading = /choose a tier/i

const trackingHeading = /time tracking/i
const repoHeading = /keep it in your repo/i

export async function openOnboarding(page: Page): Promise<void> {
	await page.goto("/dashboard")
	await page.locator('[data-tour="first-checkpoint"]').click()
	await expect(page.getByRole("heading", { name: experienceHeading })).toBeVisible()
}

export async function finishOnboarding(page: Page): Promise<void> {
	await expect(page.getByRole("heading", { name: trackingHeading })).toBeVisible()
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	await expect(page.getByRole("heading", { name: repoHeading })).toBeVisible()
	await page.getByRole("button", { exact: true, name: "Finish" }).click()
}
