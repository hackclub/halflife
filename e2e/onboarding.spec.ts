import { skipIntro } from "./ceremony"
import { readProjects, readUser, seedProject } from "./db"
import { expect, test } from "./fixtures"
import { experienceHeading, finishOnboarding, openOnboarding, projectHeading, tierHeading } from "./onboarding-helpers"

test("a participant can finish onboarding with their own project", async ({ openAs }) => {
	const { page, user } = await openAs({ onboarding: "new" })
	// Anchor onboarding to PCB, the week with a starter, so the custom-project branch of the fork exists whatever week the suite runs in.
	await seedProject(user.id)
	await skipIntro(page)
	await openOnboarding(page)

	await page.getByRole("button", { name: /just a little/ }).click()
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	// A little experience still gets the starter fork; take the custom-project branch.
	await expect(page.getByText("New to this?", { exact: true })).toBeVisible()
	await page.getByRole("button", { exact: true, name: "Make a custom project" }).click()
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	await expect(page.getByRole("heading", { name: projectHeading })).toBeVisible()
	await page.locator("#onboarding-project-name").fill("E2E Marble Run")
	await page.locator("#onboarding-project-description").fill("A project created by the browser test suite.")
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	await expect(page.getByRole("heading", { name: tierHeading })).toBeVisible()
	await page.locator('input[name="onboarding-tier"]').nth(1).check({ force: true })
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	await finishOnboarding(page)

	await expect
		.poll(async () => (await readUser(user.id))?.onboardingCompletedAt ?? null, { timeout: 15_000 })
		.not.toBeNull()

	const persisted = await readUser(user.id)
	expect(persisted?.onboardingStep).toBe(7)
	expect(persisted?.hardwareExperience).toBe("A_LITTLE")

	const projects = await readProjects(user.id)
	expect(projects[0]?.title).toBe("E2E Marble Run")
	expect(projects[0]?.requestedTier).toBe(2)
	expect(projects[0]?.starterProjectId).toBeNull()

	// A reload must read the completion from the server, not from the closed modal.
	await page.reload()
	await expect(page.getByRole("heading", { name: experienceHeading })).toHaveCount(0)
})

test("a beginner can take a starter project", async ({ openAs }) => {
	const { page, user } = await openAs({ onboarding: "new" })
	// The starter fork only exists in a week that has a starter, so anchor onboarding to PCB rather than to the current week.
	await seedProject(user.id)
	await skipIntro(page)
	await openOnboarding(page)

	await page.getByRole("button", { name: /this is my first time/ }).click()
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	await expect(page.getByText("New to this?", { exact: true })).toBeVisible()
	await page
		.getByRole("button", { name: /^Build / })
		.first()
		.click()
	await page.getByRole("button", { exact: true, name: "Next" }).click()

	// A starter answers the project, idea and tier steps, so tracking is next.
	await finishOnboarding(page)

	await expect
		.poll(async () => (await readUser(user.id))?.onboardingCompletedAt ?? null, { timeout: 15_000 })
		.not.toBeNull()

	const persisted = await readUser(user.id)
	expect(persisted?.hardwareExperience).toBe("FIRST_TIME")

	const [project] = await readProjects(user.id)
	expect(project?.starterProjectId).not.toBeNull()
	expect(project?.requestedTier).toBe(1)
	expect(project?.title.length).toBeGreaterThan(0)
})
