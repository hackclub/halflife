import { sessionCookie } from "./auth"
import { seedApprovedProject, seedProject, seedUser } from "./db"
import { expect, test } from "./fixtures"

/**
 * The grant-card purpose links to here, so a maker or anyone they forward it to must always land on the project –
 * the owner's own page when they are signed in as the maker, the public one for anyone else. Both cover the
 * "No such project" complaint this opened with: a submitted project must be visibly started, or neither lookup
 * serves it and a recipient of a paid card hits a dead banner.
 */
test("the maker opens their own project page from a purpose link", async ({ browser, baseURL }) => {
	const maker = await seedUser({ onboarding: "complete", verified: true })
	const projectId = await seedApprovedProject(maker.id)

	const context = await browser.newContext({
		baseURL,
		storageState: { cookies: [sessionCookie(maker.token)], origins: [] },
	})
	const page = await context.newPage()
	await page.goto(`/projects/${projectId}`)
	await expect(page.getByRole("heading", { name: "E2E payout" })).toBeVisible({ timeout: 15_000 })
	await context.close()
})

test("a stranger opening the same link sees the public page, not No such project", async ({ openAs }) => {
	const maker = await seedUser({ onboarding: "complete", verified: true })
	const projectId = await seedApprovedProject(maker.id)
	const stranger = await openAs({ onboarding: "complete", role: "ADMIN" })

	await stranger.page.goto(`/projects/${projectId}`)
	await expect(stranger.page.getByRole("heading", { name: "E2E payout" })).toBeVisible({ timeout: 15_000 })
})

test("an unstarted placeholder row stays hidden", async ({ openAs }) => {
	const maker = await seedUser({ onboarding: "complete", verified: true })
	const placeholderId = await seedProject(maker.id, "CAD")
	const stranger = await openAs({ onboarding: "complete", role: "ADMIN" })

	await stranger.page.goto(`/projects/${placeholderId}`)
	await expect(stranger.page.getByText("No such project")).toBeVisible({ timeout: 15_000 })
})
